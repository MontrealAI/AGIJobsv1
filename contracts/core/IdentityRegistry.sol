// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";

interface IENSLike {
    function owner(bytes32 node) external view returns (address);
}

/// @title IdentityRegistry
/// @notice Maintains ENS related configuration and an emergency allow list.
contract IdentityRegistry is Ownable {
    event EnsConfigured(address indexed registry, bytes32 agentRootHash, bytes32 clubRootHash);
    event EmergencyAccessUpdated(address indexed account, bool allowed);

    address public ensRegistry;
    bytes32 public agentRootHash;
    bytes32 public clubRootHash;

    mapping(address => bool) private _emergencyAllowList;

    string private constant _ENS_UNCONFIGURED = "IdentityRegistry: ENS";
    string private constant _AGENT_ROOT_UNCONFIGURED = "IdentityRegistry: agent root";
    string private constant _CLUB_ROOT_UNCONFIGURED = "IdentityRegistry: club root";

    /// @notice Configures the ENS registry and root hashes for access control.
    /// @param registry Address of the ENS registry used for verification.
    /// @param agentHash Node hash representing the authorized agent subdomain.
    /// @param clubHash Node hash representing the authorized club subdomain.
    function configureMainnet(address registry, bytes32 agentHash, bytes32 clubHash) external onlyOwner {
        require(registry != address(0), "IdentityRegistry: registry");
        require(agentHash != bytes32(0), "IdentityRegistry: agent hash");
        require(clubHash != bytes32(0), "IdentityRegistry: club hash");
        ensRegistry = registry;
        agentRootHash = agentHash;
        clubRootHash = clubHash;
        emit EnsConfigured(registry, agentHash, clubHash);
    }

    /// @notice Adds or removes an address from the emergency allow list.
    /// @param account Address to modify on the allow list.
    /// @param allowed True to grant emergency access, false to revoke.
    function setEmergencyAccess(address account, bool allowed) external onlyOwner {
        _emergencyAllowList[account] = allowed;
        emit EmergencyAccessUpdated(account, allowed);
    }

    /// @notice Returns true when the account is explicitly allow listed for emergencies.
    /// @param account Address queried for emergency permissions.
    /// @return True if the account can raise emergency actions.
    function hasEmergencyAccess(address account) external view returns (bool) {
        return _emergencyAllowList[account];
    }

    /// @notice Checks whether a provided ENS node hash belongs to the configured agent root.
    /// @param nodeHash ENS node hash being validated.
    /// @return True if the hash matches the configured agent root.
    function isAgentNode(bytes32 nodeHash) external view returns (bool) {
        return nodeHash == agentRootHash;
    }

    /// @notice Checks whether a provided ENS node hash belongs to the configured club root.
    /// @param nodeHash ENS node hash being validated.
    /// @return True if the hash matches the configured club root.
    function isClubNode(bytes32 nodeHash) external view returns (bool) {
        return nodeHash == clubRootHash;
    }

    /// @notice Computes the ENS node derived from the configured agent root and the provided labels.
    /// @param labels Sequence of label hashes descending from the agent root (e.g. [`keccak256("alpha")`, `keccak256("member")`]).
    /// @return node ENS node hash representing the derived subdomain.
    function resolveAgentNode(bytes32[] calldata labels) external view returns (bytes32 node) {
        _ensureEnsConfigured();
        node = _deriveNode(_requireAgentRoot(), labels);
    }

    /// @notice Computes the ENS node derived from the configured club root and the provided labels.
    /// @param labels Sequence of label hashes descending from the club root.
    /// @return node ENS node hash representing the derived subdomain.
    function resolveClubNode(bytes32[] calldata labels) external view returns (bytes32 node) {
        _ensureEnsConfigured();
        node = _deriveNode(_requireClubRoot(), labels);
    }

    /// @notice Verifies that the provided account currently controls the derived agent subdomain.
    /// @param account Address expected to own the resolved agent node.
    /// @param labels Sequence of label hashes descending from the agent root.
    /// @return True if the ENS registry reports the account as the owner of the derived node.
    function isAgentAddress(address account, bytes32[] calldata labels) external view returns (bool) {
        _ensureEnsConfigured();
        return _ownsNode(account, _deriveNode(_requireAgentRoot(), labels));
    }

    /// @notice Verifies that the provided account currently controls the derived club subdomain.
    /// @param account Address expected to own the resolved club node.
    /// @param labels Sequence of label hashes descending from the club root.
    /// @return True if the ENS registry reports the account as the owner of the derived node.
    function isClubAddress(address account, bytes32[] calldata labels) external view returns (bool) {
        _ensureEnsConfigured();
        return _ownsNode(account, _deriveNode(_requireClubRoot(), labels));
    }

    /// @notice Returns the account that currently owns the resolved agent node.
    /// @param labels Sequence of label hashes descending from the agent root.
    /// @return Address returned by the ENS registry for the derived node.
    function agentNodeOwner(bytes32[] calldata labels) external view returns (address) {
        _ensureEnsConfigured();
        return _nodeOwner(_deriveNode(_requireAgentRoot(), labels));
    }

    /// @notice Returns the account that currently owns the resolved club node.
    /// @param labels Sequence of label hashes descending from the club root.
    /// @return Address returned by the ENS registry for the derived node.
    function clubNodeOwner(bytes32[] calldata labels) external view returns (address) {
        _ensureEnsConfigured();
        return _nodeOwner(_deriveNode(_requireClubRoot(), labels));
    }

    function _deriveNode(bytes32 root, bytes32[] calldata labels) private pure returns (bytes32 node) {
        node = root;
        for (uint256 i = 0; i < labels.length; i++) {
            node = keccak256(abi.encodePacked(node, labels[i]));
        }
    }

    function _ownsNode(address account, bytes32 node) private view returns (bool) {
        if (account == address(0)) {
            return false;
        }
        return _nodeOwner(node) == account;
    }

    function _nodeOwner(bytes32 node) private view returns (address) {
        _ensureEnsConfigured();
        return IENSLike(ensRegistry).owner(node);
    }

    function _requireAgentRoot() private view returns (bytes32) {
        bytes32 root = agentRootHash;
        require(root != bytes32(0), _AGENT_ROOT_UNCONFIGURED);
        return root;
    }

    function _requireClubRoot() private view returns (bytes32) {
        bytes32 root = clubRootHash;
        require(root != bytes32(0), _CLUB_ROOT_UNCONFIGURED);
        return root;
    }

    function _ensureEnsConfigured() private view {
        require(ensRegistry != address(0), _ENS_UNCONFIGURED);
    }
}
