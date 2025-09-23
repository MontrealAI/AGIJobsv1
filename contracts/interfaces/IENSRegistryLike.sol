// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IENSRegistryLike {
    function owner(bytes32 node) external view returns (address);
}
