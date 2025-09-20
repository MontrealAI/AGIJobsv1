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

    /// @notice Increases the allowance granted to the spender.
    /// @param spender Address allowed to transfer tokens on behalf of the caller.
    /// @param addedValue Additional tokens the spender can transfer.
    /// @return True when the update succeeds.
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        uint256 newAllowance = allowance[msg.sender][spender] + addedValue;
        _approve(msg.sender, spender, newAllowance);
        return true;
    }

    /// @notice Decreases the allowance granted to the spender.
    /// @param spender Address allowed to transfer tokens on behalf of the caller.
    /// @param subtractedValue Amount to subtract from the current allowance.
    /// @return True when the update succeeds.
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 currentAllowance = allowance[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "MockERC20: allowance");
        uint256 newAllowance;
        unchecked {
            newAllowance = currentAllowance - subtractedValue;
        }
        _approve(msg.sender, spender, newAllowance);
        return true;
    }

    /// @notice Transfers tokens from a source address to a destination using allowance.
    /// @param from Account that currently holds the tokens.
    /// @param to Recipient of the transferred tokens.
    /// @param amount Quantity of tokens to send.
    /// @return True when the transfer succeeds.
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "MockERC20: transfer zero");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "MockERC20: balance");
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0) && spender != address(0), "MockERC20: approve zero");
        allowance[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _spendAllowance(address owner, address spender, uint256 amount) internal {
        if (spender == owner) {
            return;
        }

        uint256 currentAllowance = allowance[owner][spender];
        if (currentAllowance == type(uint256).max) {
            return;
        }

        require(currentAllowance >= amount, "MockERC20: allowance");
        unchecked {
            allowance[owner][spender] = currentAllowance - amount;
        }
        emit Approval(owner, spender, allowance[owner][spender]);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "MockERC20: mint to zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
