// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IENSRegistryLike} from "../interfaces/IENSRegistryLike.sol";

/// @dev Lightweight ENS registry used for tests that require ownership tracking.
contract MockENSRegistry is IENSRegistryLike {
    event Transfer(bytes32 indexed node, address owner);
    event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner);

    mapping(bytes32 => address) private _owners;

    constructor() {
        _owners[bytes32(0)] = msg.sender;
        emit Transfer(bytes32(0), msg.sender);
    }

    /// @notice Returns the current owner for a node hash.
    /// @param node Hash identifying the ENS node.
    /// @return Address that controls the specified node.
    function owner(bytes32 node) external view override returns (address) {
        return _owners[node];
    }

    /// @notice Assigns ownership of a node to a new address.
    /// @param node Hash identifying the ENS node being updated.
    /// @param newOwner Address that will become the new owner of the node.
    function setOwner(bytes32 node, address newOwner) external {
        require(_owners[node] == msg.sender, "MockENSRegistry: owner");
        _setOwner(node, newOwner);
    }

    /// @notice Assigns ownership of a subnode derived from the provided label.
    /// @param node Parent node hash.
    /// @param label Label used to derive the subnode hash.
    /// @param newOwner Address that will own the derived subnode.
    /// @return subnode Hash of the derived subnode.
    function setSubnodeOwner(bytes32 node, bytes32 label, address newOwner) external returns (bytes32 subnode) {
        require(_owners[node] == msg.sender, "MockENSRegistry: owner");
        subnode = keccak256(abi.encodePacked(node, label));
        _setOwner(subnode, newOwner);
        emit NewOwner(node, label, newOwner);
    }

    function _setOwner(bytes32 node, address newOwner) internal {
        _owners[node] = newOwner;
        emit Transfer(node, newOwner);
    }
}
