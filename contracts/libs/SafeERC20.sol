// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

// solhint-disable avoid-low-level-calls

import {IERC20} from "./IERC20.sol";

/// @dev Lightweight helpers to safely interact with ERC20 tokens.
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _call(token, abi.encodeWithSelector(token.transfer.selector, to, value));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _call(token, abi.encodeWithSelector(token.transferFrom.selector, from, to, value));
    }

    function _call(IERC20 token, bytes memory data) private {
        // solhint-disable-next-line avoid-low-level-calls
        // slither-disable-next-line low-level-calls
        (bool success, bytes memory returndata) = address(token).call(data);
        require(success, "SafeERC20: call failed");
        if (returndata.length > 0) {
            require(abi.decode(returndata, (bool)), "SafeERC20: operation failed");
        }
    }
}
