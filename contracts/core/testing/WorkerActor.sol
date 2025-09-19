// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/* istanbul ignore file */

import {StakeManager} from "../StakeManager.sol";
import {JobRegistry} from "../JobRegistry.sol";

contract WorkerActor {
    StakeManager private immutable stakeManager;
    JobRegistry private immutable jobRegistry;

    constructor(StakeManager stakeManager_, JobRegistry jobRegistry_) {
        stakeManager = stakeManager_;
        jobRegistry = jobRegistry_;
    }

    function deposit(uint256 amount) external {
        stakeManager.deposit(amount);
    }

    function withdraw(uint256 amount) external {
        stakeManager.withdraw(amount);
    }

    function commit(uint256 jobId, bytes32 commitHash) external {
        jobRegistry.commitJob(jobId, commitHash);
    }

    function reveal(uint256 jobId, bytes32 commitSecret) external {
        jobRegistry.revealJob(jobId, commitSecret);
    }
}
