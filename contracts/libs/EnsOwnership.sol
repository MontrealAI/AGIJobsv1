// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IENSRegistryLike {
    function owner(bytes32 node) external view returns (address);
}

interface IENSNameWrapperLike {
    function ownerOf(uint256 id) external view returns (address);

    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry);
}

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

        uint256 tokenId = uint256(node);
        try IENSNameWrapperLike(wrapper).ownerOf(tokenId) returns (address wrappedOwner) {
            if (wrappedOwner != address(0)) {
                return wrappedOwner;
            }
        } catch {}

        try IENSNameWrapperLike(wrapper).getData(tokenId) returns (address wrappedOwner, uint32, uint64) {
            if (wrappedOwner != address(0)) {
                return wrappedOwner;
            }
        } catch {}

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
}
