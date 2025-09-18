// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "../libs/Ownable.sol";

/// @title FeePool
/// @notice Records protocol fee accrual for accounting transparency.
contract FeePool is Ownable {
    event FeeRecorded(uint256 amount);

    address public immutable feeToken;
    address public immutable burnAddress;
    uint256 public totalFeesRecorded;
    address public jobRegistry;

    constructor(address token, address burnAddr) {
        feeToken = token;
        burnAddress = burnAddr;
    }

    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "FeePool: registry");
        jobRegistry = registry;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner() || msg.sender == jobRegistry, "FeePool: not authorized");
        _;
    }

    function recordFee(uint256 amount) external onlyAuthorized {
        require(amount > 0, "FeePool: amount");
        totalFeesRecorded += amount;
        emit FeeRecorded(amount);
    }
}
