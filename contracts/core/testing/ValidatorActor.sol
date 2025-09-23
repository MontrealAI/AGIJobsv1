// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/* istanbul ignore file */

import {ValidationModule} from "../ValidationModule.sol";

contract ValidatorActor {
    ValidationModule private immutable validationModule;

    constructor(ValidationModule validationModule_) {
        validationModule = validationModule_;
    }

    function commit(uint256 jobId, bool approved, bytes32 salt) external returns (bytes32) {
        bytes32 commitment = validationModule.computeCommitment(jobId, address(this), approved, salt);
        validationModule.commitValidation(jobId, commitment);
        return commitment;
    }

    function reveal(uint256 jobId, bool approved, bytes32 salt) external {
        validationModule.revealValidation(jobId, approved, salt);
    }

    function validationAddress() external view returns (address) {
        return address(validationModule);
    }
}
