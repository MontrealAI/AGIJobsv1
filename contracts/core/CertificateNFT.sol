// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "../libs/Ownable.sol";

/// @title CertificateNFT
/// @notice Minimal ERC721-like stub capturing certificate issuance events.
contract CertificateNFT is Ownable {
    event CertificateIssued(address indexed to, uint256 indexed id, string uri);

    uint256 private _nextId = 1;

    function issue(address to, string calldata uri) external onlyOwner returns (uint256) {
        require(to != address(0), "CertificateNFT: zero");
        uint256 id = _nextId++;
        emit CertificateIssued(to, id, uri);
        return id;
    }
}
