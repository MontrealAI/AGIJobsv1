// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IENSRegistryLike {
    function owner(bytes32 node) external view returns (address);
}

library EnsOwnership {
    error EnsOwnershipRegistryUnset();

    function owner(address registry, bytes32 node) internal view returns (address) {
        if (registry == address(0)) {
            revert EnsOwnershipRegistryUnset();
        }
        return IENSRegistryLike(registry).owner(node);
    }

    function isOwner(address registry, bytes32 node, address account) internal view returns (bool) {
        if (account == address(0)) {
            return false;
        }
        return owner(registry, node) == account;
    }

    function deriveNode(bytes32 root, bytes32[] memory labels) internal pure returns (bytes32 node) {
        node = root;
        for (uint256 i = 0; i < labels.length; i++) {
            node = keccak256(abi.encodePacked(node, labels[i]));
        }
    }
}
