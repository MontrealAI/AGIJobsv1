// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IENSNameWrapperLike {
    function ownerOf(uint256 id) external view returns (address);

    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry);
}
