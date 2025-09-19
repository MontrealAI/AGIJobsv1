// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "../libs/Ownable.sol";
import {IERC20} from "../interfaces/IERC20.sol";

interface IFeePool {
    function forwardToBurn(uint256 amount) external;
}

/// @title StakeManager
/// @notice Tracks stake balances, locks amounts for jobs, and records slashing events.
contract StakeManager is Ownable {
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Locked(address indexed account, uint256 amount);
    event Released(address indexed account, uint256 amount);
    event Slashed(address indexed account, uint256 amount);
    event JobRegistryUpdated(address indexed jobRegistry);
    event FeePoolUpdated(address indexed feePool);

    address public immutable stakeToken;
    uint8 public immutable stakeTokenDecimals;

    address public jobRegistry;
    address public feePool;

    mapping(address => uint256) public totalDeposits;
    mapping(address => uint256) public lockedAmounts;

    constructor(address token, uint8 decimals_) {
        stakeToken = token;
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

    /// @notice Adds stake on behalf of the caller.
    function deposit(uint256 amount) external {
        require(amount > 0, "StakeManager: amount");
        require(stakeToken != address(0), "StakeManager: token");
        IERC20 token = IERC20(stakeToken);
        require(token.allowance(msg.sender, address(this)) >= amount, "StakeManager: allowance");
        require(token.transferFrom(msg.sender, address(this), amount), "StakeManager: transferFrom");
        totalDeposits[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Allows a user to withdraw any unlocked portion of their stake.
    function withdraw(uint256 amount) external {
        require(amount > 0, "StakeManager: amount");
        uint256 available = availableStake(msg.sender);
        require(available >= amount, "StakeManager: insufficient");
        totalDeposits[msg.sender] -= amount;
        emit Withdrawn(msg.sender, amount);
        require(IERC20(stakeToken).transfer(msg.sender, amount), "StakeManager: transfer");
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
            lockedAmounts[account] -= slashAmount;
            totalDeposits[account] -= slashAmount;
            emit Slashed(account, slashAmount);
            _distributeSlash(slashAmount);
        }
        if (releaseAmount > 0) {
            lockedAmounts[account] -= releaseAmount;
            emit Released(account, releaseAmount);
        }
    }

    function slashStake(address account, uint256 amount) external onlyJobRegistry {
        require(lockedAmounts[account] >= amount, "StakeManager: exceeds locked");
        lockedAmounts[account] -= amount;
        totalDeposits[account] -= amount;
        emit Slashed(account, amount);
        _distributeSlash(amount);
    }

    /// @notice Computes the amount of stake available for locking.
    function availableStake(address account) public view returns (uint256) {
        return totalDeposits[account] - lockedAmounts[account];
    }

    function setFeePool(address pool) external onlyOwner {
        require(pool != address(0), "StakeManager: fee pool");
        feePool = pool;
        emit FeePoolUpdated(pool);
    }

    function _distributeSlash(uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        address pool = feePool;
        require(pool != address(0), "StakeManager: fee pool");
        IERC20 token = IERC20(stakeToken);
        require(token.transfer(pool, amount), "StakeManager: transfer");
        IFeePool(pool).forwardToBurn(amount);
    }
}
