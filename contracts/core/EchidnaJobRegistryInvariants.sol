// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

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
import {ReentrancyGuard} from "../libs/ReentrancyGuard.sol";

/* solhint-disable func-name-mixedcase */

/// @dev Harness used by Echidna to ensure high-level invariants remain true under fuzzing.
contract EchidnaJobRegistryInvariants is ReentrancyGuard {
    uint256 private constant MAX_STAKE = 1e18;

    StakeManager private immutable stakeManager;
    FeePool private immutable feePool;
    ValidationModule private immutable validationModule;
    DisputeModule private immutable disputeModule;
    ReputationEngine private immutable reputationEngine;
    IdentityRegistry private immutable identityRegistry;
    JobRegistry private immutable jobRegistry;

    WorkerActor[2] private workers;
    ClientActor private immutable client;

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

    function fuzzDeposit(uint8 workerIndex, uint128 rawAmount) external nonReentrant {
        WorkerActor worker = _worker(workerIndex);
        uint256 amount = (uint256(rawAmount) % MAX_STAKE) + 1;
        worker.deposit(amount);
    }

    function fuzzWithdraw(uint8 workerIndex, uint128 rawAmount) external nonReentrant {
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

    function fuzzCreateAndCommit(uint8 workerIndex, uint128 rawStake) external nonReentrant {
        WorkerActor worker = _worker(workerIndex);
        uint256 stakeAmount = (uint256(rawStake) % MAX_STAKE) + 1;

        // slither-disable-next-line reentrancy-no-eth
        worker.deposit(stakeAmount);
        // slither-disable-next-line reentrancy-no-eth
        uint256 jobId = client.createJob(stakeAmount);
        bytes32 secret = keccak256(abi.encodePacked(jobId, workerIndex, address(worker)));

        jobSecrets[jobId] = secret;
        jobWorkers[jobId] = address(worker);
        jobCompleted[jobId] = false;

        worker.commit(jobId, keccak256(abi.encodePacked(secret)));
    }

    function fuzzReveal(uint256 jobId) public nonReentrant {
        _reveal(jobId);
    }

    function _reveal(uint256 jobId) private {
        if (jobCompleted[jobId]) {
            return;
        }

        address workerAddr = jobWorkers[jobId];
        if (workerAddr == address(0)) {
            return;
        }

        JobRegistry.Job memory job = _getJob(jobId);
        if (job.state != JobRegistry.JobState.Committed) {
            return;
        }

        WorkerActor(workerAddr).reveal(jobId, jobSecrets[jobId]);
    }

    function fuzzFinalize(uint256 jobId, bool success) external nonReentrant {
        if (jobCompleted[jobId]) {
            return;
        }

        JobRegistry.Job memory job = _getJob(jobId);
        if (job.state == JobRegistry.JobState.Committed) {
            _reveal(jobId);
            job = _getJob(jobId);
        }

        if (job.state != JobRegistry.JobState.Revealed && job.state != JobRegistry.JobState.Disputed) {
            return;
        }

        JobRegistry.Thresholds memory thresholds = _getThresholds();
        uint256 feeAmount = (job.stakeAmount * thresholds.feeBps) / jobRegistry.BPS_DENOMINATOR();

        // slither-disable-next-line reentrancy-no-eth
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
    ) external nonReentrant {
        if (jobCompleted[jobId]) {
            return;
        }

        JobRegistry.Job memory job = _getJob(jobId);
        if (job.state == JobRegistry.JobState.Committed || job.state == JobRegistry.JobState.Revealed) {
            // slither-disable-next-line reentrancy-no-eth
            try client.raiseDispute(jobId) {
                job = _getJob(jobId);
            } catch {
                return;
            }
        }

        if (job.state != JobRegistry.JobState.Disputed) {
            return;
        }

        JobRegistry.Thresholds memory thresholds = _getThresholds();
        uint256 maxSlash = (job.stakeAmount * thresholds.slashBpsMax) / jobRegistry.BPS_DENOMINATOR();
        uint256 slashAmount = maxSlash > 0 ? uint256(rawSlash) % (maxSlash + 1) : 0;

        // slither-disable-next-line reentrancy-no-eth
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
    ) external nonReentrant {
        JobRegistry.Thresholds memory thresholds = _getThresholds();
        uint256 denominator = jobRegistry.BPS_DENOMINATOR();
        uint256 newMin = (uint256(quorumMinRaw) % 10) + 1;
        uint256 newMax = newMin + (uint256(quorumMaxRaw) % 10);
        uint256 newFee = uint256(feeBps) % (denominator + 1);
        uint256 newSlash = uint256(slashBpsMax) % (denominator + 1);

        if (newMax < newMin) {
            newMax = newMin;
        }

        jobRegistry.setThresholds(thresholds.approvalThresholdBps, newMin, newMax, newFee, newSlash);
    }

    function fuzzUpdateTimings(uint64 commitWindowRaw, uint64 revealWindowRaw, uint64 disputeWindowRaw)
        external
        nonReentrant
    {
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
        JobRegistry.Thresholds memory thresholds = _getThresholds();
        uint256 denominator = jobRegistry.BPS_DENOMINATOR();
        return
            thresholds.quorumMin > 0 &&
            thresholds.quorumMin <= thresholds.quorumMax &&
            thresholds.feeBps <= denominator &&
            thresholds.slashBpsMax <= denominator;
    }

    function echidna_timings_positive() external view returns (bool) {
        JobRegistry.Timings memory timings_ = _getTimings();
        return timings_.commitWindow > 0 && timings_.revealWindow > 0 && timings_.disputeWindow > 0;
    }

    function _worker(uint8 index) private view returns (WorkerActor) {
        return workers[index % workers.length];
    }

    function _getJob(uint256 jobId) private view returns (JobRegistry.Job memory job) {
        (
            job.client,
            job.worker,
            job.stakeAmount,
            job.commitDeadline,
            job.revealDeadline,
            job.disputeDeadline,
            job.commitHash,
            job.state
        ) = jobRegistry.jobs(jobId);
    }

    function _getThresholds() private view returns (JobRegistry.Thresholds memory thresholds) {
        (
            thresholds.approvalThresholdBps,
            thresholds.quorumMin,
            thresholds.quorumMax,
            thresholds.feeBps,
            thresholds.slashBpsMax
        ) = jobRegistry.thresholds();
    }

    function _getTimings() private view returns (JobRegistry.Timings memory timings_) {
        (timings_.commitWindow, timings_.revealWindow, timings_.disputeWindow) = jobRegistry.timings();
    }
}
