// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Pausable} from "../libs/Pausable.sol";

/// @title ReputationEngine
/// @notice Tracks a simple reputation score per worker.
contract ReputationEngine is Pausable {
    event ReputationUpdated(address indexed worker, int256 delta, int256 newScore);
    event JobRegistryUpdated(address indexed jobRegistry);

    mapping(address => int256) public reputation;
    address public jobRegistry;

    /// @notice Sets the job registry permitted to adjust reputation.
    /// @param registry Address of the job registry contract.
    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "ReputationEngine: registry");
        require(jobRegistry == address(0), "ReputationEngine: registry set");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    /// @notice Reassigns the registry controlling reputation adjustments.
    /// @param registry Address of the replacement registry contract.
    function updateJobRegistry(address registry) external onlyOwner whenPaused {
        require(registry != address(0), "ReputationEngine: registry");
        address current = jobRegistry;
        require(current != address(0), "ReputationEngine: registry unset");
        require(current != registry, "ReputationEngine: same registry");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    modifier onlyRegistry() {
        require(msg.sender == jobRegistry, "ReputationEngine: not registry");
        _;
    }

    /// @notice Applies a signed delta to a worker's reputation score.
    /// @param worker Address whose reputation is being adjusted.
    /// @param delta Signed amount to add (or subtract) from the worker's score.
    function adjustReputation(address worker, int256 delta) external onlyRegistry whenNotPaused {
        reputation[worker] += delta;
        emit ReputationUpdated(worker, delta, reputation[worker]);
    }
}
