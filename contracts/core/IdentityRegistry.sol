// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {EnsOwnership} from "../libs/EnsOwnership.sol";
import {Ownable} from "../libs/Ownable.sol";

/// @title IdentityRegistry
/// @notice Maintains ENS related configuration and an emergency allow list.
contract IdentityRegistry is Ownable {
    error AlphaClubInactive();
    event EnsConfigured(
        address indexed registry,
        address indexed wrapper,
        bytes32 agentRootHash,
        bytes32 clubRootHash,
        bytes32 alphaClubRootHash,
        bool alphaEnabled
    );
    event EmergencyAccessUpdated(address indexed account, bool allowed);

    address public ensRegistry;
    address public ensNameWrapper;
    bytes32 public agentRootHash;
    bytes32 public clubRootHash;
    bytes32 public alphaClubRootHash;
    bool public alphaEnabled;

    mapping(address => bool) private _emergencyAllowList;

    string private constant _ENS_UNCONFIGURED = "IdentityRegistry: ENS";
    string private constant _AGENT_ROOT_UNCONFIGURED = "IdentityRegistry: agent root";
    string private constant _CLUB_ROOT_UNCONFIGURED = "IdentityRegistry: club root";

    /// @notice Configures the ENS registry, NameWrapper and root hashes for access control.
    /// @param registry Address of the ENS registry used for verification.
    /// @param wrapper Address of the ENS NameWrapper responsible for wrapped ownership.
    /// @param agentHash Node hash representing the authorized agent subdomain.
    /// @param clubHash Node hash representing the authorized club subdomain.
    /// @param alphaClubHash Optional node hash for the alpha.club.agi.eth root.
    /// @param alphaClubEnabled Boolean flag to allow alpha root based identities.
    function configureEns(
        address registry,
        address wrapper,
        bytes32 agentHash,
        bytes32 clubHash,
        bytes32 alphaClubHash,
        bool alphaClubEnabled
    ) external onlyOwner {
        require(registry != address(0), "IdentityRegistry: registry");
        require(agentHash != bytes32(0), "IdentityRegistry: agent hash");
        require(clubHash != bytes32(0), "IdentityRegistry: club hash");
        if (alphaClubEnabled) {
            require(alphaClubHash != bytes32(0), "IdentityRegistry: alpha hash");
        }

        ensRegistry = registry;
        ensNameWrapper = wrapper;
        agentRootHash = agentHash;
        clubRootHash = clubHash;
        alphaClubRootHash = alphaClubHash;
        alphaEnabled = alphaClubEnabled;

        emit EnsConfigured(registry, wrapper, agentHash, clubHash, alphaClubHash, alphaClubEnabled);
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
    /// @param labels Sequence of label hashes descending from the agent root (e.g.
    /// [`keccak256("alpha")`, `keccak256("member")`]).
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
        (node, ) = _deriveClubNode(labels);
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
        (bytes32 node, bool traversedAlpha) = _deriveClubNode(labels);
        if (traversedAlpha && !alphaEnabled) {
            return false;
        }
        return _ownsNode(account, node);
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
        (bytes32 node, bool traversedAlpha) = _deriveClubNode(labels);
        if (traversedAlpha && !alphaEnabled) {
            revert AlphaClubInactive();
        }
        return _nodeOwner(node);
    }

    function _deriveNode(bytes32 root, bytes32[] calldata labels) private pure returns (bytes32 node) {
        node = root;
        for (uint256 i = 0; i < labels.length; i++) {
            node = keccak256(abi.encodePacked(node, labels[i]));
        }
    }

    function _deriveClubNode(bytes32[] calldata labels) private view returns (bytes32 node, bool traversedAlpha) {
        node = _requireClubRoot();
        bytes32 alphaRoot = alphaClubRootHash;
        for (uint256 i = 0; i < labels.length; i++) {
            node = keccak256(abi.encodePacked(node, labels[i]));
            if (alphaRoot != bytes32(0) && node == alphaRoot) {
                traversedAlpha = true;
            }
        }
    }

    function _ownsNode(address account, bytes32 node) private view returns (bool) {
        if (account == address(0)) {
            return false;
        }
        return EnsOwnership.isOwner(ensRegistry, ensNameWrapper, node, account);
    }

    function _nodeOwner(bytes32 node) private view returns (address) {
        _ensureEnsConfigured();
        return EnsOwnership.owner(ensRegistry, ensNameWrapper, node);
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
