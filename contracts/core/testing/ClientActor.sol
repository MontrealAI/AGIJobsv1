// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/* istanbul ignore file */

import {JobRegistry} from "../JobRegistry.sol";

contract ClientActor {
    JobRegistry private immutable jobRegistry;

    /// @notice Initializes the client helper with the protocol job registry.
    /// @param jobRegistry_ Job registry used to create jobs and raise disputes.
    constructor(JobRegistry jobRegistry_) {
        jobRegistry = jobRegistry_;
    }

    /// @notice Creates a new job using the backing job registry instance.
    /// @param stakeAmount Amount of stake required from the worker.
    /// @return jobId Identifier assigned to the newly created job.
    function createJob(uint256 stakeAmount) external returns (uint256) {
        return jobRegistry.createJob(stakeAmount);
    }

    /// @notice Raises a dispute for the provided job identifier via the job registry.
    /// @param jobId Identifier of the job being disputed.
    function raiseDispute(uint256 jobId) external {
        jobRegistry.raiseDispute(jobId);
    }
}
