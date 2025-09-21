// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IENSNameWrapperLike} from "./EnsOwnership.sol";

/// @dev Minimal ENS NameWrapper mock that allows toggling the ownerOf behaviour.
contract MockENSNameWrapper is IENSNameWrapperLike {
    error OwnerOfDisabled();

    mapping(uint256 => address) private _owners;
    bool private _ownerOfEnabled = true;

    function setWrappedOwner(bytes32 node, address owner) external {
        _owners[uint256(node)] = owner;
    }

    function setOwnerOfEnabled(bool enabled) external {
        _ownerOfEnabled = enabled;
    }

    function ownerOf(uint256 id) external view override returns (address) {
        if (!_ownerOfEnabled) {
            revert OwnerOfDisabled();
        }
        return _owners[id];
    }

    function getData(uint256 id) external view override returns (address owner, uint32 fuses, uint64 expiry) {
        owner = _owners[id];
        fuses = 0;
        expiry = 0;
    }
}
