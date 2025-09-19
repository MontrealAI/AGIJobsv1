// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";

/// @title IdentityRegistry
/// @notice Maintains ENS related configuration and an emergency allow list.
contract IdentityRegistry is Ownable {
    event EnsConfigured(address indexed registry, bytes32 agentRootHash, bytes32 clubRootHash);
    event EmergencyAccessUpdated(address indexed account, bool allowed);

    address public ensRegistry;
    bytes32 public agentRootHash;
    bytes32 public clubRootHash;

    mapping(address => bool) private _emergencyAllowList;

    /// @notice Configures the ENS registry and root hashes for access control.
    /// @param registry Address of the ENS registry used for verification.
    /// @param agentHash Node hash representing the authorized agent subdomain.
    /// @param clubHash Node hash representing the authorized club subdomain.
    function configureMainnet(address registry, bytes32 agentHash, bytes32 clubHash) external onlyOwner {
        require(registry != address(0), "IdentityRegistry: registry");
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
}
