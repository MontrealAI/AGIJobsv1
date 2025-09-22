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

    /// @notice Initializes the fee pool with immutable token metadata.
    /// @param token Address of the ERC20 token used for protocol fees.
    /// @param burnAddr Destination that will receive fee burns.
    constructor(address token, address burnAddr) {
        require(token != address(0), "FeePool: token");
        require(burnAddr != address(0), "FeePool: burn");
        feeToken = token;
        burnAddress = burnAddr;
    }

    /// @notice Sets the job registry authorized to report fees.
    /// @param registry Address of the job registry contract.
    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "FeePool: registry");
        require(jobRegistry == address(0), "FeePool: registry already set");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    /// @notice Reassigns the authorized registry. Enables controlled migrations.
    /// @param registry Address of the new registry contract.
    function updateJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "FeePool: registry");
        address current = jobRegistry;
        require(current != address(0), "FeePool: registry unset");
        require(current != registry, "FeePool: registry unchanged");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner() || msg.sender == jobRegistry, "FeePool: not authorized");
        _;
    }

    /// @notice Records a new amount of protocol fees accrued.
    /// @param amount Quantity of fees reported by the caller.
    function recordFee(uint256 amount) external onlyAuthorized {
        require(amount > 0, "FeePool: amount");
        totalFeesRecorded += amount;
        emit FeeRecorded(amount);
    }

    /// @notice Sends the full token balance to the configured burn address.
    function burnAccumulatedFees() external onlyOwner {
        IERC20 token = IERC20(feeToken);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "FeePool: nothing to burn");
        emit FeesBurned(balance);
        token.safeTransfer(burnAddress, balance);
    }
}
