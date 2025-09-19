// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";

/// @title ReputationEngine
/// @notice Tracks a simple reputation score per worker.
contract ReputationEngine is Ownable {
    event ReputationUpdated(address indexed worker, int256 delta, int256 newScore);
    event JobRegistryUpdated(address indexed jobRegistry);

    mapping(address => int256) public reputation;
    address public jobRegistry;

    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "ReputationEngine: registry");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    modifier onlyRegistry() {
        require(msg.sender == jobRegistry, "ReputationEngine: not registry");
        _;
    }

    function adjustReputation(address worker, int256 delta) external onlyRegistry {
        reputation[worker] += delta;
        emit ReputationUpdated(worker, delta, reputation[worker]);
    }
}
