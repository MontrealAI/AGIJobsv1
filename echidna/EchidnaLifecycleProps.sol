// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {EchidnaJobRegistryInvariants} from "../contracts/core/EchidnaJobRegistryInvariants.sol";
import {JobRegistry} from "../contracts/core/JobRegistry.sol";
import {ValidationModule} from "../contracts/core/ValidationModule.sol";

contract EchidnaLifecycleProps is EchidnaJobRegistryInvariants {
    uint256 private constant MAX_JOBS_CHECKED = 25;

    function echidna_single_commit_per_validator_job() external view returns (bool) {
        JobRegistry registry = _jobRegistryInstance();
        ValidationModule validation = _validationModuleInstance();
        uint256 total = registry.totalJobs();
        if (total > MAX_JOBS_CHECKED) {
            total = MAX_JOBS_CHECKED;
        }

        for (uint256 jobId = 1; jobId <= total; ++jobId) {
            for (uint256 i = 0; i < _validatorCount(); ++i) {
                address validator = _validatorAddress(i);
                bool active = validatorCommitMetadata[jobId][validator].active;
                bool hasCommit = validation.commitOf(jobId, validator) != bytes32(0);
                if (active != hasCommit) {
                    return false;
                }
                if (hasCommit && validation.hasRevealed(jobId, validator)) {
                    return false;
                }
            }
        }

        return true;
    }

    function echidna_reveal_requires_commit() external view returns (bool) {
        JobRegistry registry = _jobRegistryInstance();
        ValidationModule validation = _validationModuleInstance();
        uint256 total = registry.totalJobs();
        if (total > MAX_JOBS_CHECKED) {
            total = MAX_JOBS_CHECKED;
        }

        for (uint256 jobId = 1; jobId <= total; ++jobId) {
            for (uint256 i = 0; i < _validatorCount(); ++i) {
                address validator = _validatorAddress(i);
                if (validation.hasRevealed(jobId, validator)) {
                    if (validation.commitOf(jobId, validator) != bytes32(0)) {
                        return false;
                    }
                    if (validatorCommitMetadata[jobId][validator].active) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    function echidna_pending_commit_counts_match() external view returns (bool) {
        JobRegistry registry = _jobRegistryInstance();
        ValidationModule validation = _validationModuleInstance();
        uint256 total = registry.totalJobs();
        if (total > MAX_JOBS_CHECKED) {
            total = MAX_JOBS_CHECKED;
        }

        for (uint256 jobId = 1; jobId <= total; ++jobId) {
            uint256 expectedPending;
            for (uint256 i = 0; i < _validatorCount(); ++i) {
                if (validatorCommitMetadata[jobId][_validatorAddress(i)].active) {
                    expectedPending += 1;
                }
            }
            if (validation.pendingCommitCount(jobId) != expectedPending) {
                return false;
            }
        }

        return true;
    }

    function echidna_no_double_finalization() external view returns (bool) {
        JobRegistry registry = _jobRegistryInstance();
        ValidationModule validation = _validationModuleInstance();
        uint256 total = registry.totalJobs();
        if (total > MAX_JOBS_CHECKED) {
            total = MAX_JOBS_CHECKED;
        }

        for (uint256 jobId = 1; jobId <= total; ++jobId) {
            (, , , , , , , JobRegistry.JobState state) = registry.jobs(jobId);
            bool closed = validation.isJobClosed(jobId);
            if (state == JobRegistry.JobState.Finalized && !closed) {
                return false;
            }
            if (closed && state != JobRegistry.JobState.Finalized) {
                return false;
            }
        }

        return true;
    }

    function echidna_unique_terminal_states() external view returns (bool) {
        JobRegistry registry = _jobRegistryInstance();
        ValidationModule validation = _validationModuleInstance();
        uint256 total = registry.totalJobs();
        if (total > MAX_JOBS_CHECKED) {
            total = MAX_JOBS_CHECKED;
        }

        for (uint256 jobId = 1; jobId <= total; ++jobId) {
            (, , , , , , , JobRegistry.JobState state) = registry.jobs(jobId);
            bool closed = validation.isJobClosed(jobId);
            bool disputeActive = validation.isDisputeActive(jobId);
            if (closed && disputeActive) {
                return false;
            }
            if (disputeActive && state != JobRegistry.JobState.Disputed) {
                return false;
            }
            if (state == JobRegistry.JobState.Disputed && !disputeActive) {
                return false;
            }
        }

        return true;
    }
}
