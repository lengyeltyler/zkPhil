// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LocalSmartAccount} from "./LocalSmartAccount.sol";

/// @title LocalSmartAccountFactory
/// @notice Deterministic CREATE2 factory for local smart accounts.
contract LocalSmartAccountFactory {
    event AccountCreated(address indexed owner, bytes32 indexed salt, address indexed account);

    function getSalt(address owner, uint256 userSalt) public pure returns (bytes32) {
        return keccak256(abi.encode(owner, userSalt));
    }

    function getAddress(address owner, uint256 userSalt) public view returns (address) {
        bytes memory bytecode = abi.encodePacked(type(LocalSmartAccount).creationCode, abi.encode(owner));
        bytes32 digest = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                getSalt(owner, userSalt),
                keccak256(bytecode)
            )
        );
        return address(uint160(uint256(digest)));
    }

    function createAccount(address owner, uint256 userSalt) external returns (address account) {
        account = getAddress(owner, userSalt);
        if (account.code.length > 0) {
            return account;
        }
        bytes32 salt = getSalt(owner, userSalt);
        account = address(new LocalSmartAccount{salt: salt}(owner));
        emit AccountCreated(owner, salt, account);
    }
}
