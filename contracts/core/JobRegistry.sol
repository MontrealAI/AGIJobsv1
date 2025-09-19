// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";
import {ReentrancyGuard} from "../libs/ReentrancyGuard.sol";
import {StakeManager} from "./StakeManager.sol";
import {FeePool} from "./FeePool.sol";
import {DisputeModule} from "./DisputeModule.sol";
import {ReputationEngine} from "./ReputationEngine.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";

/// @title JobRegistry
/// @notice Coordinates job lifecycle, stake locking, and fee routing.
contract JobRegistry is Ownable, ReentrancyGuard {
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum JobState { None, Created, Committed, Revealed, Finalized, Disputed }

    struct Modules {
        address identity;
        address staking;
        address validation;
        address dispute;
        address reputation;
        address feePool;
    }

    struct Timings {
        uint256 commitWindow;
        uint256 revealWindow;
        uint256 disputeWindow;
    }

    struct Thresholds {
        uint256 approvalThresholdBps;
        uint256 quorumMin;
        uint256 quorumMax;
        uint256 feeBps;
        uint256 slashBpsMax;
    }

    struct Job {
        address client;
        address worker;
        uint256 stakeAmount;
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 disputeDeadline;
        bytes32 commitHash;
        JobState state;
    }

    Modules private _modules;
    Timings public timings;
    Thresholds public thresholds;

    uint256 public totalJobs;
    mapping(uint256 => Job) public jobs;

    event ModulesUpdated(Modules modules);
    event TimingsUpdated(Timings timings);
    event ThresholdsUpdated(Thresholds thresholds);
    event JobCreated(uint256 indexed jobId, address indexed client, uint256 stakeAmount);
    event JobCommitted(uint256 indexed jobId, address indexed worker, bytes32 commitHash);
    event JobRevealed(uint256 indexed jobId, address indexed worker);
    event JobFinalized(uint256 indexed jobId, bool success, uint256 feeAmount);
    event JobDisputed(uint256 indexed jobId, address indexed raiser);
    event DisputeResolved(uint256 indexed jobId, bool slashed, uint256 slashAmount);

    error InvalidState(JobState expected, JobState actual);
    error WindowExpired(string window);
    error FeeBounds();
    error NotConfigured(bytes32 component);
    error UnauthorizedDisputeRaiser(uint256 jobId, address caller);

    bytes32 private constant MODULES_KEY = "modules";
    bytes32 private constant TIMINGS_KEY = "timings";
    bytes32 private constant THRESHOLDS_KEY = "thresholds";

    bool private _timingsConfigured;
    bool private _thresholdsConfigured;

    function modules() external view returns (Modules memory) {
        return _modules;
    }

    function configurationStatus()
        external
        view
        returns (bool modulesConfigured, bool timingsConfigured, bool thresholdsConfigured)
    {
        modulesConfigured = _areModulesConfigured();
        timingsConfigured = _timingsConfigured;
        thresholdsConfigured = _thresholdsConfigured;
    }

    function isFullyConfigured() external view returns (bool) {
        return _areModulesConfigured() && _timingsConfigured && _thresholdsConfigured;
    }

    function setModules(Modules calldata newModules) external onlyOwner {
        require(newModules.identity != address(0), "JobRegistry: identity");
        require(newModules.staking != address(0), "JobRegistry: staking");
        require(newModules.feePool != address(0), "JobRegistry: feePool");

        _modules = newModules;
        emit ModulesUpdated(newModules);
    }

    function setTimings(uint256 commitWindow, uint256 revealWindow, uint256 disputeWindow) external onlyOwner {
        require(commitWindow > 0 && revealWindow > 0 && disputeWindow > 0, "JobRegistry: timings");
        timings = Timings(commitWindow, revealWindow, disputeWindow);
        _timingsConfigured = true;
        emit TimingsUpdated(timings);
    }

    function setThresholds(
        uint256 approvalThresholdBps,
        uint256 quorumMin,
        uint256 quorumMax,
        uint256 feeBps,
        uint256 slashBpsMax
    ) external onlyOwner {
        require(quorumMin > 0 && quorumMax >= quorumMin, "JobRegistry: quorum");
        require(feeBps <= BPS_DENOMINATOR, "JobRegistry: fee bps");
        require(slashBpsMax <= BPS_DENOMINATOR, "JobRegistry: slash bps");

        thresholds = Thresholds({
            approvalThresholdBps: approvalThresholdBps,
            quorumMin: quorumMin,
            quorumMax: quorumMax,
            feeBps: feeBps,
            slashBpsMax: slashBpsMax
        });
        _thresholdsConfigured = true;
        emit ThresholdsUpdated(thresholds);
    }

    function createJob(uint256 stakeAmount) external returns (uint256 jobId) {
        _requireLifecycleConfigured();
        require(stakeAmount > 0, "JobRegistry: stake amount");
        Timings memory cfg = timings;
        jobId = ++totalJobs;
        Job storage job = jobs[jobId];
        job.client = msg.sender;
        job.stakeAmount = stakeAmount;
        job.commitDeadline = block.timestamp + cfg.commitWindow;
        job.revealDeadline = job.commitDeadline + cfg.revealWindow;
        job.disputeDeadline = job.revealDeadline + cfg.disputeWindow;
        job.state = JobState.Created;
        emit JobCreated(jobId, msg.sender, stakeAmount);
    }

    function commitJob(uint256 jobId, bytes32 commitHash) external nonReentrant {
        _requireModulesConfigured();
        Job storage job = jobs[jobId];
        _requireState(job.state, JobState.Created);
        // slither-disable-next-line timestamp
        if (block.timestamp > job.commitDeadline) revert WindowExpired("commit");

        job.worker = msg.sender;
        job.commitHash = commitHash;
        job.state = JobState.Committed;

        StakeManager(_modules.staking).lockStake(msg.sender, job.stakeAmount);
        emit JobCommitted(jobId, msg.sender, commitHash);
    }

    function revealJob(uint256 jobId, bytes32 commitSecret) external {
        Job storage job = jobs[jobId];
        _requireState(job.state, JobState.Committed);
        // slither-disable-next-line timestamp
        if (block.timestamp > job.revealDeadline) revert WindowExpired("reveal");
        require(job.worker == msg.sender, "JobRegistry: not worker");
        require(job.commitHash == keccak256(abi.encodePacked(commitSecret)), "JobRegistry: commit mismatch");

        job.state = JobState.Revealed;
        emit JobRevealed(jobId, msg.sender);
    }

    function finalizeJob(uint256 jobId, bool success) external onlyOwner nonReentrant {
        _requireModulesConfigured();
        _requireThresholdsConfigured();
        Job storage job = jobs[jobId];
        if (job.state != JobState.Revealed && job.state != JobState.Disputed) {
            revert InvalidState(JobState.Revealed, job.state);
        }

        uint256 feeAmount = (job.stakeAmount * thresholds.feeBps) / BPS_DENOMINATOR;
        if (feeAmount > job.stakeAmount) revert FeeBounds();

        StakeManager staking = StakeManager(_modules.staking);
        FeePool feePool = FeePool(_modules.feePool);

        uint256 releaseAmount = job.stakeAmount - feeAmount;
        job.state = JobState.Finalized;
        staking.settleStake(job.worker, releaseAmount, feeAmount);
        if (feeAmount > 0) {
            feePool.recordFee(feeAmount);
        }

        emit JobFinalized(jobId, success, feeAmount);
    }

    function raiseDispute(uint256 jobId) external nonReentrant {
        _requireModulesConfigured();
        Job storage job = jobs[jobId];
        if (job.state != JobState.Revealed && job.state != JobState.Committed) {
            revert InvalidState(JobState.Revealed, job.state);
        }
        // slither-disable-next-line timestamp
        if (block.timestamp > job.disputeDeadline) revert WindowExpired("dispute");
        if (!_isAuthorizedDisputeRaiser(job, msg.sender)) {
            revert UnauthorizedDisputeRaiser(jobId, msg.sender);
        }
        job.state = JobState.Disputed;
        DisputeModule(_modules.dispute).onDisputeRaised(jobId, msg.sender);
        emit JobDisputed(jobId, msg.sender);
    }

    function resolveDispute(uint256 jobId, bool slashWorker, uint256 slashAmount, int256 reputationDelta)
        external
        onlyOwner
        nonReentrant
    {
        _requireModulesConfigured();
        _requireThresholdsConfigured();
        Job storage job = jobs[jobId];
        _requireState(job.state, JobState.Disputed);

        job.state = JobState.Finalized;

        if (slashWorker) {
            uint256 maxSlash = (job.stakeAmount * thresholds.slashBpsMax) / BPS_DENOMINATOR;
            if (slashAmount > maxSlash) revert("JobRegistry: slash bounds");
            StakeManager(_modules.staking).slashStake(job.worker, slashAmount);
        } else {
            StakeManager(_modules.staking).releaseStake(job.worker, job.stakeAmount);
        }

        if (reputationDelta != 0) {
            ReputationEngine(_modules.reputation).adjustReputation(job.worker, reputationDelta);
        }

        DisputeModule(_modules.dispute).onDisputeResolved(jobId, slashWorker);
        emit DisputeResolved(jobId, slashWorker, slashAmount);
    }

    function _requireState(JobState current, JobState expected) private pure {
        if (current != expected) {
            revert InvalidState(expected, current);
        }
    }

    function _requireModulesConfigured() private view {
        if (!_areModulesConfigured()) {
            revert NotConfigured(MODULES_KEY);
        }
    }

    function _requireThresholdsConfigured() private view {
        if (!_thresholdsConfigured) {
            revert NotConfigured(THRESHOLDS_KEY);
        }
    }

    function _requireLifecycleConfigured() private view {
        _requireModulesConfigured();
        if (!_timingsConfigured) {
            revert NotConfigured(TIMINGS_KEY);
        }
        _requireThresholdsConfigured();
    }

    function _areModulesConfigured() private view returns (bool) {
        return _modules.identity != address(0)
            && _modules.staking != address(0)
            && _modules.validation != address(0)
            && _modules.dispute != address(0)
            && _modules.reputation != address(0)
            && _modules.feePool != address(0);
    }

    function _isAuthorizedDisputeRaiser(Job storage job, address caller) private view returns (bool) {
        if (caller == job.client || caller == job.worker || caller == owner()) {
            return true;
        }
        address identity = _modules.identity;
        if (identity != address(0)) {
            return IdentityRegistry(identity).hasEmergencyAccess(caller);
        }
        return false;
    }
}
