// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/* istanbul ignore file */

import {StakeManager} from "../StakeManager.sol";
import {JobRegistry} from "../JobRegistry.sol";
import {IERC20} from "../../libs/IERC20.sol";

contract WorkerActor {
    StakeManager private immutable stakeManager;
    JobRegistry private immutable jobRegistry;
    IERC20 private immutable stakeToken;

    /// @notice Initializes the worker helper with references to core protocol contracts.
    /// @param stakeManager_ Stake manager contract controlling worker balances.
    /// @param jobRegistry_ Job registry coordinating job commitments.
    constructor(StakeManager stakeManager_, JobRegistry jobRegistry_, IERC20 stakeToken_) {
        stakeManager = stakeManager_;
        jobRegistry = jobRegistry_;
        stakeToken = stakeToken_;
    }

    /// @notice Deposits tokens into the stake manager using the worker actor.
    /// @param amount Quantity of tokens to deposit.
    function deposit(uint256 amount) external {
        _approveIfNeeded(amount);
        stakeManager.deposit(amount);
    }

    /// @notice Ensures the stake manager has enough allowance to transfer tokens.
    /// @param amount Minimum allowance to guarantee for the stake manager.
    function approveStakeManager(uint256 amount) external {
        _approveIfNeeded(amount);
    }

    /// @notice Withdraws unlocked stake from the stake manager on behalf of the worker.
    /// @param amount Quantity of tokens to withdraw.
    function withdraw(uint256 amount) external {
        stakeManager.withdraw(amount);
    }

    /// @notice Commits to a job via the job registry with the provided hash.
    /// @param jobId Identifier of the job being committed to.
    /// @param commitHash Hash of the secret generated for the job commit.
    function commit(uint256 jobId, bytes32 commitHash) external {
        jobRegistry.commitJob(jobId, commitHash);
    }

    /// @notice Reveals the commitment secret for a job in the job registry.
    /// @param jobId Identifier of the job being revealed.
    /// @param commitSecret Secret value matching the commitment hash.
    function reveal(uint256 jobId, bytes32 commitSecret) external {
        jobRegistry.revealJob(jobId, commitSecret);
    }

    function _approveIfNeeded(uint256 amount) private {
        if (stakeToken.allowance(address(this), address(stakeManager)) < amount) {
            stakeToken.approve(address(stakeManager), type(uint256).max);
        }
    }
}
