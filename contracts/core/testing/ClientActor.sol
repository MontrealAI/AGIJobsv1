// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/* istanbul ignore file */

import {JobRegistry} from "../JobRegistry.sol";

contract ClientActor {
    JobRegistry private immutable jobRegistry;

    constructor(JobRegistry jobRegistry_) {
        jobRegistry = jobRegistry_;
    }

    function createJob(uint256 stakeAmount) external returns (uint256) {
        return jobRegistry.createJob(stakeAmount);
    }

    function raiseDispute(uint256 jobId) external {
        jobRegistry.raiseDispute(jobId);
    }
}
