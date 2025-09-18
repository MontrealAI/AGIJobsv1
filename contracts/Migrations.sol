// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract Migrations {
    address public owner;
    uint256 public lastCompletedMigration;

    constructor() {
        owner = msg.sender;
    }

    modifier restricted() {
        require(msg.sender == owner, "Migrations: not owner");
        _;
    }

    function setCompleted(uint256 completed) external restricted {
        lastCompletedMigration = completed;
    }
}
