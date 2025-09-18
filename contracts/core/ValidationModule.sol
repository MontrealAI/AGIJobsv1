// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "../libs/Ownable.sol";

/// @title ValidationModule
/// @notice Placeholder validation hook to demonstrate wiring expectations.
contract ValidationModule is Ownable {
    event ValidationRuleUpdated(bytes32 indexed rule, bool enabled);

    mapping(bytes32 => bool) public validationRules;

    function setValidationRule(bytes32 rule, bool enabled) external onlyOwner {
        validationRules[rule] = enabled;
        emit ValidationRuleUpdated(rule, enabled);
    }
}
