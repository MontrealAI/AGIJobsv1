// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "./Ownable.sol";

/// @title Pausable
/// @notice Minimal pausable pattern controlled by the contract owner.
abstract contract Pausable is Ownable {
    event Paused(address account);
    event Unpaused(address account);

    bool private _paused;

    /// @notice Ensures a function is callable only while the contract is not paused.
    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    /// @notice Ensures a function is callable only while the contract is paused.
    modifier whenPaused() {
        require(_paused, "Pausable: not paused");
        _;
    }

    /// @notice Reports whether the contract is currently paused.
    /// @return True when the contract is paused.
    function paused() public view returns (bool) {
        return _paused;
    }

    /// @notice Pauses contract functionality. Only callable by the owner.
    function pause() external onlyOwner whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resumes contract functionality. Only callable by the owner.
    function unpause() external onlyOwner whenPaused {
        _paused = false;
        emit Unpaused(msg.sender);
    }
}
