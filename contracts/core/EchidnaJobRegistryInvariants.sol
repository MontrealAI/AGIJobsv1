// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/* istanbul ignore file */

import {StakeManager} from "./StakeManager.sol";
import {FeePool} from "./FeePool.sol";
import {ValidationModule} from "./ValidationModule.sol";
import {DisputeModule} from "./DisputeModule.sol";
import {ReputationEngine} from "./ReputationEngine.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {JobRegistry} from "./JobRegistry.sol";
import {WorkerActor} from "./testing/WorkerActor.sol";
import {ClientActor} from "./testing/ClientActor.sol";

/* solhint-disable func-name-mixedcase */

/// @dev Harness used by Echidna to ensure high-level invariants remain true under fuzzing.
contract EchidnaJobRegistryInvariants {
    uint256 private constant MAX_STAKE = 1e18;

    StakeManager private stakeManager;
    FeePool private feePool;
    ValidationModule private validationModule;
    DisputeModule private disputeModule;
    ReputationEngine private reputationEngine;
    IdentityRegistry private identityRegistry;
    JobRegistry private jobRegistry;

    WorkerActor[2] private workers;
    ClientActor private client;

    mapping(uint256 => bytes32) private jobSecrets;
    mapping(uint256 => address) private jobWorkers;
    mapping(uint256 => bool) private jobCompleted;

    uint256 private expectedFees;

    constructor() {
        stakeManager = new StakeManager(address(0xBEEF), 18);
        feePool = new FeePool(address(0xBEEF), address(0xDEAD));
        validationModule = new ValidationModule();
        disputeModule = new DisputeModule();
        reputationEngine = new ReputationEngine();
        identityRegistry = new IdentityRegistry();
        jobRegistry = new JobRegistry();

        jobRegistry.setModules(
            JobRegistry.Modules({
                identity: address(identityRegistry),
                staking: address(stakeManager),
                validation: address(validationModule),
                dispute: address(disputeModule),
                reputation: address(reputationEngine),
                feePool: address(feePool)
            })
        );
        jobRegistry.setTimings(1, 1, 1);
        jobRegistry.setThresholds(6000, 1, 5, 250, 2000);

        stakeManager.setJobRegistry(address(jobRegistry));
        feePool.setJobRegistry(address(jobRegistry));
        disputeModule.setJobRegistry(address(jobRegistry));
        reputationEngine.setJobRegistry(address(jobRegistry));

        workers[0] = new WorkerActor(stakeManager, jobRegistry);
        workers[1] = new WorkerActor(stakeManager, jobRegistry);
        client = new ClientActor(jobRegistry);
    }

    function fuzzDeposit(uint8 workerIndex, uint128 rawAmount) external {
        WorkerActor worker = _worker(workerIndex);
        uint256 amount = (uint256(rawAmount) % MAX_STAKE) + 1;
        worker.deposit(amount);
    }

    function fuzzWithdraw(uint8 workerIndex, uint128 rawAmount) external {
        WorkerActor worker = _worker(workerIndex);
        uint256 available = stakeManager.availableStake(address(worker));
        if (available == 0) {
            return;
        }

        uint256 amount = uint256(rawAmount) % available;
        if (amount == 0) {
            amount = available;
        }
        worker.withdraw(amount);
    }

    function fuzzCreateAndCommit(uint8 workerIndex, uint128 rawStake) external {
        WorkerActor worker = _worker(workerIndex);
        uint256 stakeAmount = (uint256(rawStake) % MAX_STAKE) + 1;

        worker.deposit(stakeAmount);
        uint256 jobId = client.createJob(stakeAmount);
        bytes32 secret = keccak256(abi.encodePacked(jobId, workerIndex, address(worker)));

        jobSecrets[jobId] = secret;
        jobWorkers[jobId] = address(worker);
        jobCompleted[jobId] = false;

        worker.commit(jobId, keccak256(abi.encodePacked(secret)));
    }

    function fuzzReveal(uint256 jobId) public {
        if (jobCompleted[jobId]) {
            return;
        }

        address workerAddr = jobWorkers[jobId];
        if (workerAddr == address(0)) {
            return;
        }

        (JobRegistry.JobState state,,) = _getJob(jobId);
        if (state != JobRegistry.JobState.Committed) {
            return;
        }

        WorkerActor(workerAddr).reveal(jobId, jobSecrets[jobId]);
    }

    function fuzzFinalize(uint256 jobId, bool success) external {
        if (jobCompleted[jobId]) {
            return;
        }

        (JobRegistry.JobState state, uint256 stakeAmount,) = _getJob(jobId);
        if (state == JobRegistry.JobState.Committed) {
            fuzzReveal(jobId);
            (state, stakeAmount,) = _getJob(jobId);
        }

        if (state != JobRegistry.JobState.Revealed && state != JobRegistry.JobState.Disputed) {
            return;
        }

        (,,, uint256 feeBps,) = _getThresholds();
        uint256 feeAmount = (stakeAmount * feeBps) / jobRegistry.BPS_DENOMINATOR();

        try jobRegistry.finalizeJob(jobId, success) {
            expectedFees += feeAmount;
            jobCompleted[jobId] = true;
            jobWorkers[jobId] = address(0);
            jobSecrets[jobId] = bytes32(0);
        } catch {
            return;
        }
    }

    function fuzzDisputeAndResolve(
        uint256 jobId,
        bool slashWorker,
        uint128 rawSlash,
        int128 rawReputation
    ) external {
        if (jobCompleted[jobId]) {
            return;
        }

        (JobRegistry.JobState state, uint256 stakeAmount,) = _getJob(jobId);
        if (state == JobRegistry.JobState.Committed || state == JobRegistry.JobState.Revealed) {
            try client.raiseDispute(jobId) {
                (state, stakeAmount,) = _getJob(jobId);
            } catch {
                return;
            }
        }

        if (state != JobRegistry.JobState.Disputed) {
            return;
        }

        (,,, , uint256 slashBpsMax) = _getThresholds();
        uint256 maxSlash = (stakeAmount * slashBpsMax) / jobRegistry.BPS_DENOMINATOR();
        uint256 slashAmount = maxSlash > 0 ? uint256(rawSlash) % (maxSlash + 1) : 0;

        try jobRegistry.resolveDispute(jobId, slashWorker, slashAmount, int256(rawReputation)) {
            jobCompleted[jobId] = true;
            jobWorkers[jobId] = address(0);
            jobSecrets[jobId] = bytes32(0);
        } catch {
            return;
        }
    }

    function fuzzUpdateThresholds(
        uint16 feeBps,
        uint16 slashBpsMax,
        uint16 quorumMinRaw,
        uint16 quorumMaxRaw
    ) external {
        (uint256 approvalThresholdBps,, , ,) = _getThresholds();
        uint256 denominator = jobRegistry.BPS_DENOMINATOR();
        uint256 newMin = (uint256(quorumMinRaw) % 10) + 1;
        uint256 newMax = newMin + (uint256(quorumMaxRaw) % 10);
        uint256 newFee = uint256(feeBps) % (denominator + 1);
        uint256 newSlash = uint256(slashBpsMax) % (denominator + 1);

        if (newMax < newMin) {
            newMax = newMin;
        }

        jobRegistry.setThresholds(approvalThresholdBps, newMin, newMax, newFee, newSlash);
    }

    function fuzzUpdateTimings(uint64 commitWindowRaw, uint64 revealWindowRaw, uint64 disputeWindowRaw) external {
        uint256 commitWindow = (uint256(commitWindowRaw) % 7 days) + 1;
        uint256 revealWindow = (uint256(revealWindowRaw) % 7 days) + 1;
        uint256 disputeWindow = (uint256(disputeWindowRaw) % 7 days) + 1;

        jobRegistry.setTimings(commitWindow, revealWindow, disputeWindow);
    }

    function echidna_worker0_stake_conserved() external view returns (bool) {
        address workerAddr = address(workers[0]);
        return stakeManager.totalDeposits(workerAddr) >= stakeManager.lockedAmounts(workerAddr);
    }

    function echidna_worker1_stake_conserved() external view returns (bool) {
        address workerAddr = address(workers[1]);
        return stakeManager.totalDeposits(workerAddr) >= stakeManager.lockedAmounts(workerAddr);
    }

    function echidna_fee_accounting_consistent() external view returns (bool) {
        return feePool.totalFeesRecorded() == expectedFees;
    }

    function echidna_threshold_bounds_hold() external view returns (bool) {
        (
            ,
            uint256 quorumMin,
            uint256 quorumMax,
            uint256 feeBps,
            uint256 slashBpsMax
        ) = _getThresholds();
        uint256 denominator = jobRegistry.BPS_DENOMINATOR();
        return
            quorumMin > 0 &&
            quorumMin <= quorumMax &&
            feeBps <= denominator &&
            slashBpsMax <= denominator;
    }

    function echidna_timings_positive() external view returns (bool) {
        (uint256 commitWindow, uint256 revealWindow, uint256 disputeWindow) = _getTimings();
        return commitWindow > 0 && revealWindow > 0 && disputeWindow > 0;
    }

    function _worker(uint8 index) private view returns (WorkerActor) {
        return workers[index % workers.length];
    }

    function _getJob(uint256 jobId)
        private
        view
        returns (JobRegistry.JobState state, uint256 stakeAmount, address workerAddr)
    {
        (
            ,
            address worker,
            uint256 stakeAmount_,
            ,
            ,
            ,
            ,
            JobRegistry.JobState state_
        ) = jobRegistry.jobs(jobId);

        return (state_, stakeAmount_, worker);
    }

    function _getThresholds()
        private
        view
        returns (
            uint256 approvalThresholdBps,
            uint256 quorumMin,
            uint256 quorumMax,
            uint256 feeBps,
            uint256 slashBpsMax
        )
    {
        return jobRegistry.thresholds();
    }

    function _getTimings()
        private
        view
        returns (uint256 commitWindow, uint256 revealWindow, uint256 disputeWindow)
    {
        return jobRegistry.timings();
    }
}
