// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";

/// @title DisputeModule
/// @notice Manages job dispute resolutions and emits lifecycle events.
contract DisputeModule is Ownable {
    event DisputeRaised(uint256 indexed jobId, address indexed raiser);
    event DisputeResolved(uint256 indexed jobId, bool slashWorker);
    event JobRegistryUpdated(address indexed jobRegistry);

    address public jobRegistry;

    /// @notice Sets the job registry permitted to raise dispute events.
    /// @param registry Address of the job registry contract.
    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "DisputeModule: registry");
        require(jobRegistry == address(0), "DisputeModule: registry already set");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    modifier onlyRegistry() {
        require(msg.sender == jobRegistry, "DisputeModule: not registry");
        _;
    }

    /// @notice Emits an event when a job dispute is raised.
    /// @param jobId Identifier of the disputed job.
    /// @param raiser Address that initiated the dispute.
    function onDisputeRaised(uint256 jobId, address raiser) external onlyRegistry {
        emit DisputeRaised(jobId, raiser);
    }

    /// @notice Emits an event after a dispute has been resolved.
    /// @param jobId Identifier of the disputed job.
    /// @param slashWorker True if the resolution slashed the worker.
    function onDisputeResolved(uint256 jobId, bool slashWorker) external onlyRegistry {
        emit DisputeResolved(jobId, slashWorker);
    }
}
