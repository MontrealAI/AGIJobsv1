// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";

/// @title ValidationModule
/// @notice Placeholder validation hook to demonstrate wiring expectations.
contract ValidationModule is Ownable {
    event ValidationRuleUpdated(bytes32 indexed rule, bool enabled);

    mapping(bytes32 => bool) public validationRules;

    /// @notice Enables or disables a validation rule for job submissions.
    /// @param rule Identifier of the validation rule.
    /// @param enabled True to enable the rule, false to disable.
    function setValidationRule(bytes32 rule, bool enabled) external onlyOwner {
        validationRules[rule] = enabled;
        emit ValidationRuleUpdated(rule, enabled);
    }
}
