// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockStarknetCore {
    event MessageConsumed(uint256 indexed fromAddress, bytes32 indexed payloadHash);

    function consumeMessageFromL2(uint256 fromAddress, uint256[] calldata payload) external returns (bytes32) {
        bytes32 payloadHash = keccak256(abi.encode(payload));
        emit MessageConsumed(fromAddress, payloadHash);
        return payloadHash;
    }
}
