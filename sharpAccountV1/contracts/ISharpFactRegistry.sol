// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISharpFactRegistry {
    function isValid(bytes32 fact) external view returns (bool);
}

