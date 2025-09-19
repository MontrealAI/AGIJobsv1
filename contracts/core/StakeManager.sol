// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";
import {IERC20} from "../libs/IERC20.sol";
import {SafeERC20} from "../libs/SafeERC20.sol";

/// @title StakeManager
/// @notice Tracks stake balances, locks amounts for jobs, and records slashing events.
contract StakeManager is Ownable {
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Locked(address indexed account, uint256 amount);
    event Released(address indexed account, uint256 amount);
    event Slashed(address indexed account, uint256 amount);
    event JobRegistryUpdated(address indexed jobRegistry);
    event FeeRecipientUpdated(address indexed feeRecipient);

    using SafeERC20 for IERC20;

    IERC20 public immutable stakeToken;
    uint8 public immutable stakeTokenDecimals;

    address public jobRegistry;
    address public feeRecipient;

    mapping(address => uint256) public totalDeposits;
    mapping(address => uint256) public lockedAmounts;

    constructor(address token, uint8 decimals_) {
        require(token != address(0), "StakeManager: token");
        stakeToken = IERC20(token);
        stakeTokenDecimals = decimals_;
    }

    modifier onlyJobRegistry() {
        require(msg.sender == jobRegistry, "StakeManager: not registry");
        _;
    }

    /// @notice Sets the job registry allowed to lock and release stakes.
    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "StakeManager: zero registry");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    /// @notice Sets the address that receives slashed stake.
    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "StakeManager: fee recipient");
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    /// @notice Adds stake on behalf of the caller.
    function deposit(uint256 amount) external {
        require(amount > 0, "StakeManager: amount");
        IERC20 token = stakeToken;
        require(token.allowance(msg.sender, address(this)) >= amount, "StakeManager: allowance");
        token.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposits[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Allows a user to withdraw any unlocked portion of their stake.
    function withdraw(uint256 amount) external {
        require(amount > 0, "StakeManager: amount");
        uint256 available = availableStake(msg.sender);
        require(available >= amount, "StakeManager: insufficient");
        stakeToken.safeTransfer(msg.sender, amount);
        totalDeposits[msg.sender] -= amount;
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Locks stake for a job. Only callable by the configured job registry.
    function lockStake(address account, uint256 amount) external onlyJobRegistry {
        require(amount > 0, "StakeManager: amount");
        require(availableStake(account) >= amount, "StakeManager: insufficient");
        lockedAmounts[account] += amount;
        emit Locked(account, amount);
    }

    /// @notice Releases locked stake back to the available balance.
    function releaseStake(address account, uint256 amount) external onlyJobRegistry {
        require(lockedAmounts[account] >= amount, "StakeManager: exceeds locked");
        lockedAmounts[account] -= amount;
        emit Released(account, amount);
    }

    /// @notice Burns a portion of locked stake.
    function settleStake(address account, uint256 releaseAmount, uint256 slashAmount) external onlyJobRegistry {
        require(releaseAmount + slashAmount > 0, "StakeManager: nothing to settle");
        uint256 total = releaseAmount + slashAmount;
        require(lockedAmounts[account] >= total, "StakeManager: exceeds locked");
        if (slashAmount > 0) {
            address recipient = feeRecipient;
            require(recipient != address(0), "StakeManager: fee recipient");
            lockedAmounts[account] -= slashAmount;
            totalDeposits[account] -= slashAmount;
            stakeToken.safeTransfer(recipient, slashAmount);
            emit Slashed(account, slashAmount);
        }
        if (releaseAmount > 0) {
            lockedAmounts[account] -= releaseAmount;
            emit Released(account, releaseAmount);
        }
    }

    function slashStake(address account, uint256 amount) external onlyJobRegistry {
        require(lockedAmounts[account] >= amount, "StakeManager: exceeds locked");
        address recipient = feeRecipient;
        require(recipient != address(0), "StakeManager: fee recipient");
        lockedAmounts[account] -= amount;
        totalDeposits[account] -= amount;
        stakeToken.safeTransfer(recipient, amount);
        emit Slashed(account, amount);
    }

    /// @notice Computes the amount of stake available for locking.
    function availableStake(address account) public view returns (uint256) {
        return totalDeposits[account] - lockedAmounts[account];
    }
}
