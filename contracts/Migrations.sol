// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

contract Migrations {
    address public immutable owner;
    uint256 public lastCompletedMigration;

    constructor() {
        owner = msg.sender;
    }

    modifier restricted() {
        require(msg.sender == owner, "Migrations: not owner");
        _;
    }

    /// @notice Updates the highest completed migration index.
    /// @param completed The latest migration sequence number that finished execution.
    function setCompleted(uint256 completed) external restricted {
        lastCompletedMigration = completed;
    }
}
