// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IStarknetCore
/// @notice Minimal Starknet L1 core interface for consuming L2->L1 messages
interface IStarknetCore {
    function consumeMessageFromL2(uint256 fromAddress, uint256[] calldata payload) external returns (bytes32);
}

/// @title PhilUnlockInbox
/// @notice Receives STARK unlock tickets via Starknet L2 messaging
/// @dev Stores the latest valid ticket per vault address
contract PhilUnlockInbox {
    uint256 private constant CONSTRAINTS_HASH_WORD_BITS = 128;

    struct Ticket {
        uint64 nonce;
        uint32 validAfter;
        uint32 validUntil;
        uint32 scope;
        bytes32 constraintsHash;
    }

    IStarknetCore public immutable starknetCore;
    /// @notice Starknet L2 sender contract felt that is allowed to emit unlock tickets.
    uint256 public immutable l2UnlockSender;

    mapping(address => Ticket) private _latestTicket;
    mapping(address => uint64) public lastNonce;

    event TicketRecorded(
        address indexed vault,
        uint64 nonce,
        uint32 validAfter,
        uint32 validUntil,
        uint32 scope,
        bytes32 constraintsHash
    );

    error InvalidNonce();

    /// @param starknetCore_ Starknet L1 core contract
    /// @param l2UnlockSender_ Starknet L2 sender contract address (felt)
    constructor(address starknetCore_, uint256 l2UnlockSender_) {
        starknetCore = IStarknetCore(starknetCore_);
        l2UnlockSender = l2UnlockSender_;
    }

    /// @notice Record an unlock ticket via a Starknet L2 message
    /// @dev Payload layout must match the L2 unlock sender:
    ///      [vault, nonce, validAfter, validUntil, scope, constraintsHashHi128, constraintsHashLo128]
    function recordTicket(
        address vault,
        uint64 nonce,
        uint32 validAfter,
        uint32 validUntil,
        uint32 scope,
        bytes32 constraintsHash
    ) external {
        uint64 prev = lastNonce[vault];
        if (nonce <= prev) revert InvalidNonce();

        (uint256 constraintsHashHi, uint256 constraintsHashLo) = _splitConstraintsHash(constraintsHash);

        uint256[] memory payload = new uint256[](7);
        payload[0] = uint256(uint160(vault));
        payload[1] = uint256(nonce);
        payload[2] = uint256(validAfter);
        payload[3] = uint256(validUntil);
        payload[4] = uint256(scope);
        payload[5] = constraintsHashHi;
        payload[6] = constraintsHashLo;

        lastNonce[vault] = nonce;
        _latestTicket[vault] = Ticket(nonce, validAfter, validUntil, scope, constraintsHash);

        // Validates the L2->L1 message and consumes it.
        starknetCore.consumeMessageFromL2(l2UnlockSender, payload);

        emit TicketRecorded(vault, nonce, validAfter, validUntil, scope, constraintsHash);
    }

    /// @notice Legacy getter retained so older tooling can still inspect pre-rename semantics.
    function l2VerifierAddress() external view returns (uint256) {
        return l2UnlockSender;
    }

    function getTicket(address vault) external view returns (Ticket memory) {
        return _latestTicket[vault];
    }

    function _splitConstraintsHash(bytes32 constraintsHash) private pure returns (uint256 hi, uint256 lo) {
        uint256 value = uint256(constraintsHash);
        hi = value >> CONSTRAINTS_HASH_WORD_BITS;
        lo = value & ((uint256(1) << CONSTRAINTS_HASH_WORD_BITS) - 1);
    }
}
