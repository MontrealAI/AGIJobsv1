// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "../libs/Ownable.sol";
import {IERC20} from "../interfaces/IERC20.sol";

/// @title FeePool
/// @notice Records protocol fee accrual for accounting transparency.
contract FeePool is Ownable {
    event FeeRecorded(uint256 amount);
    event JobRegistryUpdated(address indexed jobRegistry);
    event StakeManagerUpdated(address indexed staking);
    event SlashHandled(uint256 amount);

    address public immutable feeToken;
    address public immutable burnAddress;
    uint256 public totalFeesRecorded;
    address public jobRegistry;
    address public staking;

    constructor(address token, address burnAddr) {
        require(token != address(0), "FeePool: token");
        require(burnAddr != address(0), "FeePool: burn");
        feeToken = token;
        burnAddress = burnAddr;
    }

    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "FeePool: registry");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    function setStakeManager(address staking_) external onlyOwner {
        require(staking_ != address(0), "FeePool: staking");
        staking = staking_;
        emit StakeManagerUpdated(staking_);
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner() || msg.sender == jobRegistry, "FeePool: not authorized");
        _;
    }

    modifier onlyStaking() {
        require(msg.sender == staking, "FeePool: not staking");
        _;
    }

    function recordFee(uint256 amount) external onlyAuthorized {
        require(amount > 0, "FeePool: amount");
        totalFeesRecorded += amount;
        emit FeeRecorded(amount);
    }

    function handleSlash(uint256 amount) external onlyStaking {
        require(amount > 0, "FeePool: amount");
        require(IERC20(feeToken).transfer(burnAddress, amount), "FeePool: burn failed");
        emit SlashHandled(amount);
    }
}
