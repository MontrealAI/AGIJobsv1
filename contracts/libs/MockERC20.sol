// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {IERC20} from "./IERC20.sol";

/// @dev Minimal ERC20 token used in tests and local deployments.
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    uint256 public override totalSupply;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    /// @notice Initializes the mock token and mints the initial supply.
    /// @param name_ Token name exposed via the ERC20 interface.
    /// @param symbol_ Token symbol exposed via the ERC20 interface.
    /// @param decimals_ Number of decimals the token uses.
    /// @param initialHolder Account receiving the initial token allocation.
    /// @param initialSupply Quantity of tokens to mint during deployment.
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialHolder,
        uint256 initialSupply
    ) {
        require(initialHolder != address(0), "MockERC20: holder");
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        _mint(initialHolder, initialSupply);
    }

    /// @notice Transfers tokens from the caller to a destination address.
    /// @param to Recipient of the transferred tokens.
    /// @param amount Quantity of tokens to send.
    /// @return True when the transfer succeeds.
    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Approves a spender to transfer tokens from the caller.
    /// @param spender Address allowed to transfer tokens on behalf of the caller.
    /// @param amount Maximum amount the spender can transfer.
    /// @return True when the approval succeeds.
    function approve(address spender, uint256 amount) external override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfers tokens from a source address to a destination using allowance.
    /// @param from Account that currently holds the tokens.
    /// @param to Recipient of the transferred tokens.
    /// @param amount Quantity of tokens to send.
    /// @return True when the transfer succeeds.
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (msg.sender != from) {
            uint256 currentAllowance = allowance[from][msg.sender];
            require(currentAllowance >= amount, "MockERC20: allowance");
            unchecked {
                allowance[from][msg.sender] = currentAllowance - amount;
            }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "MockERC20: transfer");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "MockERC20: balance");
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0) && spender != address(0), "MockERC20: approve");
        allowance[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
