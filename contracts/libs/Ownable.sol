// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/// @title Minimal Ownable pattern used for protocol scaffolding
abstract contract Ownable {
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    address private _owner;

    modifier onlyOwner() {
        require(msg.sender == _owner, "Ownable: caller is not the owner");
        _;
    }

    constructor() {
        _transferOwnership(msg.sender);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Ownable: zero address");
        _transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal {
        address previous = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }
}
