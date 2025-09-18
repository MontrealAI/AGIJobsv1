// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

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
    function configureMainnet(address registry, bytes32 agentHash, bytes32 clubHash) external onlyOwner {
        require(registry != address(0), "IdentityRegistry: registry");
        ensRegistry = registry;
        agentRootHash = agentHash;
        clubRootHash = clubHash;
        emit EnsConfigured(registry, agentHash, clubHash);
    }

    /// @notice Adds or removes an address from the emergency allow list.
    function setEmergencyAccess(address account, bool allowed) external onlyOwner {
        _emergencyAllowList[account] = allowed;
        emit EmergencyAccessUpdated(account, allowed);
    }

    /// @notice Returns true when the account is explicitly allow listed for emergencies.
    function hasEmergencyAccess(address account) external view returns (bool) {
        return _emergencyAllowList[account];
    }

    /// @notice Checks whether a provided ENS node hash belongs to the configured agent root.
    function isAgentNode(bytes32 nodeHash) external view returns (bool) {
        return nodeHash == agentRootHash;
    }

    /// @notice Checks whether a provided ENS node hash belongs to the configured club root.
    function isClubNode(bytes32 nodeHash) external view returns (bool) {
        return nodeHash == clubRootHash;
    }
}
