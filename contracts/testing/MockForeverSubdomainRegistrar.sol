// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

contract MockForeverSubdomainRegistrar {
    struct Name {
        address pricer;
        address beneficiary;
        bool active;
    }

    mapping(bytes32 => Name) public names;

    event DomainConfigured(bytes32 indexed node, address pricer, address beneficiary, bool active);

    function setName(bytes32 node, address pricer, address beneficiary, bool active) external {
        names[node] = Name({pricer: pricer, beneficiary: beneficiary, active: active});
        emit DomainConfigured(node, pricer, beneficiary, active);
    }
}
