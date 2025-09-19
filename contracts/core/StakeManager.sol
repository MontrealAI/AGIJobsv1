// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";
import {ReentrancyGuard} from "../libs/ReentrancyGuard.sol";
import {IERC20} from "../libs/IERC20.sol";
import {SafeERC20} from "../libs/SafeERC20.sol";

/// @title StakeManager
/// @notice Tracks stake balances, locks amounts for jobs, and records slashing events.
contract StakeManager is Ownable, ReentrancyGuard {
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
    /// @param registry Address of the registry contract that can manage stake locks.
    function setJobRegistry(address registry) external onlyOwner {
        require(registry != address(0), "StakeManager: zero registry");
        jobRegistry = registry;
        emit JobRegistryUpdated(registry);
    }

    /// @notice Sets the address that receives slashed stake.
    /// @param recipient Destination that will receive slashed stake proceeds.
    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "StakeManager: fee recipient");
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    /// @notice Adds stake on behalf of the caller.
    /// @param amount Quantity of tokens to deposit as stake.
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "StakeManager: amount");
        IERC20 token = stakeToken;
        require(token.allowance(msg.sender, address(this)) >= amount, "StakeManager: allowance");
        token.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposits[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Allows a user to withdraw any unlocked portion of their stake.
    /// @param amount Quantity of tokens to withdraw from available stake.
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "StakeManager: amount");
        uint256 available = availableStake(msg.sender);
        require(available >= amount, "StakeManager: insufficient");
        totalDeposits[msg.sender] -= amount;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Locks stake for a job. Only callable by the configured job registry.
    /// @param account Worker whose stake will be locked.
    /// @param amount Quantity of tokens to lock for the job lifecycle.
    function lockStake(address account, uint256 amount) external onlyJobRegistry {
        require(amount > 0, "StakeManager: amount");
        require(availableStake(account) >= amount, "StakeManager: insufficient");
        lockedAmounts[account] += amount;
        emit Locked(account, amount);
    }

    /// @notice Releases locked stake back to the available balance.
    /// @param account Worker whose locked stake will be released.
    /// @param amount Quantity of tokens to move back to the unlocked balance.
    function releaseStake(address account, uint256 amount) external onlyJobRegistry {
        require(lockedAmounts[account] >= amount, "StakeManager: exceeds locked");
        lockedAmounts[account] -= amount;
        emit Released(account, amount);
    }

    /// @notice Settles a job by slashing and/or releasing locked stake.
    /// @param account Worker whose stake is being adjusted.
    /// @param releaseAmount Portion of stake released back to the available balance.
    /// @param slashAmount Portion of stake transferred to the fee recipient.
    function settleStake(address account, uint256 releaseAmount, uint256 slashAmount)
        external
        onlyJobRegistry
        nonReentrant
    {
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

    /// @notice Slashes locked stake and forwards it to the fee recipient.
    /// @param account Worker whose locked stake is being slashed.
    /// @param amount Amount of stake to slash.
    function slashStake(address account, uint256 amount) external onlyJobRegistry nonReentrant {
        require(lockedAmounts[account] >= amount, "StakeManager: exceeds locked");
        address recipient = feeRecipient;
        require(recipient != address(0), "StakeManager: fee recipient");
        lockedAmounts[account] -= amount;
        totalDeposits[account] -= amount;
        stakeToken.safeTransfer(recipient, amount);
        emit Slashed(account, amount);
    }

    /// @notice Computes the amount of stake available for locking.
    /// @param account Worker whose available stake is being queried.
    /// @return amount Amount of unlocked stake that can be locked for jobs.
    function availableStake(address account) public view returns (uint256) {
        return totalDeposits[account] - lockedAmounts[account];
    }
}
