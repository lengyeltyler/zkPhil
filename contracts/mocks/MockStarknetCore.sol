// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockStarknetCore {
    uint256 private constant STARKNET_FIELD_PRIME =
        0x800000000000011000000000000000000000000000000000000000000000001;

    event MessageConsumed(uint256 indexed fromAddress, bytes32 indexed payloadHash);
    error FeltOutOfRange(uint256 value);

    function consumeMessageFromL2(uint256 fromAddress, uint256[] calldata payload) external returns (bytes32) {
        _requireFelt(fromAddress);
        for (uint256 i = 0; i < payload.length; i++) {
            _requireFelt(payload[i]);
        }
        bytes32 payloadHash = keccak256(abi.encode(payload));
        emit MessageConsumed(fromAddress, payloadHash);
        return payloadHash;
    }

    function _requireFelt(uint256 value) private pure {
        if (value >= STARKNET_FIELD_PRIME) revert FeltOutOfRange(value);
    }
}
