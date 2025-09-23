// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IENSRegistryLike} from "../interfaces/IENSRegistryLike.sol";
import {IENSNameWrapperLike} from "../interfaces/IENSNameWrapperLike.sol";

library EnsOwnership {
    error EnsOwnershipRegistryUnset();

    function owner(address registry, address wrapper, bytes32 node) internal view returns (address) {
        if (registry == address(0)) {
            revert EnsOwnershipRegistryUnset();
        }

        address currentOwner = IENSRegistryLike(registry).owner(node);
        if (currentOwner != wrapper || wrapper == address(0)) {
            return currentOwner;
        }

        address wrappedOwner = _resolveWrappedOwner(wrapper, uint256(node));
        if (wrappedOwner != address(0)) {
            return wrappedOwner;
        }

        return currentOwner;
    }

    function isOwner(address registry, address wrapper, bytes32 node, address account) internal view returns (bool) {
        if (account == address(0)) {
            return false;
        }
        return owner(registry, wrapper, node) == account;
    }

    function deriveNode(bytes32 root, bytes32[] memory labels) internal pure returns (bytes32 node) {
        node = root;
        for (uint256 i = 0; i < labels.length; i++) {
            node = keccak256(abi.encodePacked(node, labels[i]));
        }
    }

    function _resolveWrappedOwner(address wrapper, uint256 tokenId) private view returns (address) {
        if (wrapper == address(0)) {
            return address(0);
        }

        address wrappedOwner = _wrappedOwnerViaOwnerOf(wrapper, tokenId);
        if (wrappedOwner != address(0)) {
            return wrappedOwner;
        }

        return _wrappedOwnerViaGetData(wrapper, tokenId);
    }

    function _wrappedOwnerViaOwnerOf(address wrapper, uint256 tokenId) private view returns (address) {
        try IENSNameWrapperLike(wrapper).ownerOf(tokenId) returns (address wrappedOwner) {
            return wrappedOwner;
        } catch {
            return address(0);
        }
    }

    function _wrappedOwnerViaGetData(address wrapper, uint256 tokenId) private view returns (address) {
        try IENSNameWrapperLike(wrapper).getData(tokenId) returns (address wrappedOwner, uint32 fuses, uint64 expiry) {
            if (wrappedOwner == address(0) && fuses == 0 && expiry == 0) {
                return address(0);
            }

            if (expiry != 0 && expiry < block.timestamp) {
                return address(0);
            }

            return wrappedOwner;
        } catch {
            return address(0);
        }
    }
}
