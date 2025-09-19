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

    function onDisputeRaised(uint256 jobId, address raiser) external onlyRegistry {
        emit DisputeRaised(jobId, raiser);
    }

    function onDisputeResolved(uint256 jobId, bool slashWorker) external onlyRegistry {
        emit DisputeResolved(jobId, slashWorker);
    }
}
