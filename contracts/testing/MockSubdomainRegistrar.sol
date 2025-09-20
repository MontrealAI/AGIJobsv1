// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

contract MockSubdomainPricer {
    address public token;
    uint256 public quotedPrice;
    bool public shouldRevert;

    constructor(address token_, uint256 price_) {
        token = token_;
        quotedPrice = price_;
    }

    function setToken(address token_) external {
        token = token_;
    }

    function setPrice(uint256 price_) external {
        quotedPrice = price_;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function price(bytes32, string calldata, uint256) external view returns (address, uint256) {
        require(!shouldRevert, "Pricer: revert requested");
        return (token, quotedPrice);
    }
}

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
