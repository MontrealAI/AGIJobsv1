// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";

/// @title ValidationModule
/// @notice Coordinates validator commit/reveal attestations for job finalization.
contract ValidationModule is Ownable {
    event JobRegistryUpdated(address indexed jobRegistry);
    event ValidationCommitted(uint256 indexed jobId, address indexed validator, bytes32 commitHash);
    event ValidationRevealed(
        uint256 indexed jobId,
        address indexed validator,
        bool approved,
        bytes32 salt
    );

    error ValidationCommitHashEmpty();
    error ValidationCommitExists(uint256 jobId, address validator);
    error ValidationCommitMissing(uint256 jobId, address validator);
    error ValidationCommitMismatch(uint256 jobId, address validator);
    error ValidationCommitAccountingUnderflow(uint256 jobId);
    error ValidationPending(uint256 jobId);
    error ValidationJobClosed(uint256 jobId);
    error ValidationDisputeActive(uint256 jobId);
    error ValidationDisputeInactive(uint256 jobId);
    error ValidationRegistryUnset();
    error ValidationRegistryAlreadySet();

    bytes32 public constant COMMIT_NS = keccak256("agi.validation.commit");

    address public jobRegistry;

    mapping(uint256 => mapping(address => bytes32)) public commitOf;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;
    mapping(uint256 => mapping(address => bool)) public voteOf;
    mapping(uint256 => uint256) public approvals;
    mapping(uint256 => uint256) public rejections;

    mapping(uint256 => uint256) private _pendingCommits;
    mapping(uint256 => bool) private _finalized;
    mapping(uint256 => bool) private _disputeActive;

    modifier onlyRegistry() {
        require(msg.sender == jobRegistry, "ValidationModule: not registry");
        _;
    }

    /// @notice Sets the job registry allowed to perform lifecycle guards.
    /// @param registry Address of the job registry contract.
    function setJobRegistry(address registry) external onlyOwner {
        if (registry == address(0)) revert ValidationRegistryUnset();
        if (jobRegistry != address(0)) revert ValidationRegistryAlreadySet();
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    /// @notice Updates the registry reference. Only callable when already configured.
    /// @param registry Address of the replacement registry contract.
    function updateJobRegistry(address registry) external onlyOwner {
        if (registry == address(0)) revert ValidationRegistryUnset();
        address current = jobRegistry;
        if (current == address(0)) revert ValidationRegistryUnset();
        if (current == registry) revert ValidationRegistryAlreadySet();
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    /// @notice Computes the commitment hash for a validator attestation.
    /// @param jobId Identifier of the job being validated.
    /// @param validator Address of the validator producing the commitment.
    /// @param approved Validator decision encoded as a boolean flag.
    /// @param salt Secret salt that must be provided during the reveal phase.
    /// @return Commitment hash that must be supplied to {commitValidation}.
    function computeCommitment(
        uint256 jobId,
        address validator,
        bool approved,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(COMMIT_NS, block.chainid, jobId, validator, approved, salt));
    }

    /// @notice Records a validator commitment for the provided job identifier.
    /// @param jobId Identifier of the job being validated.
    /// @param commitHash Commitment hash computed off-chain.
    function commitValidation(uint256 jobId, bytes32 commitHash) external {
        if (jobRegistry == address(0)) revert ValidationRegistryUnset();
        if (commitHash == bytes32(0)) revert ValidationCommitHashEmpty();
        if (_finalized[jobId]) revert ValidationJobClosed(jobId);
        if (_disputeActive[jobId]) revert ValidationDisputeActive(jobId);

        mapping(address => bytes32) storage commits = commitOf[jobId];
        address validator = msg.sender;
        if (commits[validator] != bytes32(0)) {
            revert ValidationCommitExists(jobId, validator);
        }

        commits[validator] = commitHash;
        _pendingCommits[jobId] += 1;

        emit ValidationCommitted(jobId, validator, commitHash);
    }

    /// @notice Reveals the validator decision and clears the stored commitment.
    /// @param jobId Identifier of the job being validated.
    /// @param approved Validator decision revealed during this phase.
    /// @param salt Secret salt that must match the commitment hash.
    function revealValidation(uint256 jobId, bool approved, bytes32 salt) external {
        mapping(address => bytes32) storage commits = commitOf[jobId];
        address validator = msg.sender;
        bytes32 storedCommit = commits[validator];
        if (storedCommit == bytes32(0)) {
            revert ValidationCommitMissing(jobId, validator);
        }

        bytes32 expected = computeCommitment(jobId, validator, approved, salt);
        if (expected != storedCommit) {
            revert ValidationCommitMismatch(jobId, validator);
        }

        _onValidationRevealed(jobId, validator, approved);
        delete commits[validator];

        uint256 pending = _pendingCommits[jobId];
        if (pending == 0) revert ValidationCommitAccountingUnderflow(jobId);
        unchecked {
            _pendingCommits[jobId] = pending - 1;
        }

        emit ValidationRevealed(jobId, validator, approved, salt);
    }

    /// @notice Ensures a job has no pending commits before finalization.
    /// @param jobId Identifier of the job transitioning to a terminal state.
    function beforeFinalize(uint256 jobId) external onlyRegistry {
        if (_pendingCommits[jobId] != 0) revert ValidationPending(jobId);
        if (_finalized[jobId]) revert ValidationJobClosed(jobId);
        _finalized[jobId] = true;
    }

    /// @notice Signals that a dispute has been raised for the provided job.
    /// @param jobId Identifier of the disputed job.
    function beforeDispute(uint256 jobId) external onlyRegistry {
        if (_finalized[jobId]) revert ValidationJobClosed(jobId);
        if (_disputeActive[jobId]) revert ValidationDisputeActive(jobId);
        _disputeActive[jobId] = true;
    }

    /// @notice Clears the dispute flag and records the job as finalized.
    /// @param jobId Identifier of the job being resolved.
    function beforeDisputeResolution(uint256 jobId) external onlyRegistry {
        if (_pendingCommits[jobId] != 0) revert ValidationPending(jobId);
        if (!_disputeActive[jobId]) revert ValidationDisputeInactive(jobId);
        if (_finalized[jobId]) revert ValidationJobClosed(jobId);

        _disputeActive[jobId] = false;
        _finalized[jobId] = true;
    }

    /// @notice Returns the number of pending validator commits for a job.
    /// @param jobId Identifier of the job being inspected.
    /// @return Pending commit count recorded for the job.
    function pendingCommitCount(uint256 jobId) external view returns (uint256) {
        return _pendingCommits[jobId];
    }

    /// @notice Reports whether the validation lifecycle has reached a terminal state.
    /// @param jobId Identifier of the job being inspected.
    /// @return True when the job can no longer accept commits or disputes.
    function isJobClosed(uint256 jobId) external view returns (bool) {
        return _finalized[jobId];
    }

    /// @notice Indicates whether a job has an active dispute.
    /// @param jobId Identifier of the job being inspected.
    /// @return True when the job currently has an open dispute.
    function isDisputeActive(uint256 jobId) external view returns (bool) {
        return _disputeActive[jobId];
    }

    function _onValidationRevealed(uint256 jobId, address validator, bool approved) internal {
        hasRevealed[jobId][validator] = true;
        voteOf[jobId][validator] = approved;
        if (approved) {
            approvals[jobId] += 1;
        } else {
            rejections[jobId] += 1;
        }
    }
}
