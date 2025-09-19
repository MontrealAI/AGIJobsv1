// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {StakeManager} from "../core/StakeManager.sol";
import {IERC20} from "../libs/IERC20.sol";

/// @dev Helper contract used in tests to attempt reentrant withdrawals from the
/// stake manager when receiving tokens from a custom ERC20.
contract StakeManagerReentrancyAttacker {
    StakeManager public immutable stakeManager;
    IERC20 public immutable stakeToken;

    uint256 public reenterAmount;
    bool public reenterCallSucceeded;
    bool private reentered;

    constructor(address stakeManager_, address stakeToken_) {
        require(stakeManager_ != address(0), "ReentrancyAttacker: manager");
        require(stakeToken_ != address(0), "ReentrancyAttacker: token");
        stakeManager = StakeManager(stakeManager_);
        stakeToken = IERC20(stakeToken_);
    }

    function approveAndDeposit(uint256 amount) external {
        stakeToken.approve(address(stakeManager), amount);
        stakeManager.deposit(amount);
    }

    function attemptWithdraw(uint256 withdrawAmount, uint256 reenterAmount_) external {
        reenterAmount = reenterAmount_;
        reenterCallSucceeded = false;
        reentered = false;
        stakeManager.withdraw(withdrawAmount);
    }

    function onTokenTransfer() external {
        require(msg.sender == address(stakeToken), "ReentrancyAttacker: caller");
        if (!reentered && reenterAmount > 0) {
            reentered = true;
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(stakeManager).call(
                abi.encodeWithSelector(stakeManager.withdraw.selector, reenterAmount)
            );
            reenterCallSucceeded = success;
        }
    }
}
