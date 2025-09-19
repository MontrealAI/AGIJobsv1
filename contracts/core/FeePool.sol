// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";
import {IERC20} from "../libs/IERC20.sol";
import {SafeERC20} from "../libs/SafeERC20.sol";

/// @title FeePool
/// @notice Records protocol fee accrual for accounting transparency.
contract FeePool is Ownable {
    event FeeRecorded(uint256 amount);
    event JobRegistryUpdated(address indexed jobRegistry);
    event FeesBurned(uint256 amount);

    address public immutable feeToken;
    address public immutable burnAddress;
    uint256 public totalFeesRecorded;
    address public jobRegistry;

    using SafeERC20 for IERC20;

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

    modifier onlyAuthorized() {
        require(msg.sender == owner() || msg.sender == jobRegistry, "FeePool: not authorized");
        _;
    }

    function recordFee(uint256 amount) external onlyAuthorized {
        require(amount > 0, "FeePool: amount");
        totalFeesRecorded += amount;
        emit FeeRecorded(amount);
    }

    /// @notice Sends the full token balance to the configured burn address.
    function burnAccumulatedFees() external onlyOwner {
        uint256 balance = IERC20(feeToken).balanceOf(address(this));
        require(balance > 0, "FeePool: nothing to burn");
        IERC20(feeToken).safeTransfer(burnAddress, balance);
        emit FeesBurned(balance);
    }
}
