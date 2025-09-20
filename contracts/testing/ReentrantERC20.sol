// SPDX-License-Identifier: MIT
/* solhint-disable one-contract-per-file */
pragma solidity 0.8.23;

import {MockERC20} from "./MockERC20.sol";

interface IStakeManagerReentrancyReceiver {
    function onTokenTransfer() external;
}

/// @dev ERC20 test double that invokes a hook on the recipient when the stake
/// manager transfers tokens, enabling reentrancy simulations in tests.
contract ReentrantERC20 is MockERC20 {
    address public immutable controller;
    address public reentrantTarget;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        MockERC20(name_, symbol_, decimals_)
    {
        controller = msg.sender;
    }

    function setReentrantTarget(address target) external {
        require(msg.sender == controller, "ReentrantERC20: controller");
        require(target != address(0), "ReentrantERC20: target");
        reentrantTarget = target;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        if (from == reentrantTarget && to.code.length > 0) {
            IStakeManagerReentrancyReceiver(to).onTokenTransfer();
        }
        super._transfer(from, to, amount);
    }
}
