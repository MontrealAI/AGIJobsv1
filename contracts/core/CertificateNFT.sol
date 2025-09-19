// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Ownable} from "../libs/Ownable.sol";

/// @title CertificateNFT
/// @notice Minimal ERC721-like stub capturing certificate issuance events.
contract CertificateNFT is Ownable {
    event CertificateIssued(address indexed to, uint256 indexed id, string uri);

    uint256 private _nextId = 1;

    /// @notice Issues a new certificate NFT and emits its metadata.
    /// @param to Recipient that achieved the certification.
    /// @param uri Metadata URI describing the certificate.
    /// @return id Newly issued certificate identifier.
    function issue(address to, string calldata uri) external onlyOwner returns (uint256 id) {
        require(to != address(0), "CertificateNFT: zero");
        id = _nextId++;
        emit CertificateIssued(to, id, uri);
    }
}
