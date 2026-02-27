// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockUnlockInbox
/// @notice Test stub for PhilUnlockInbox. Always returns an empty (all-zero) ticket.
/// @dev Deploy this as the unlockInbox_ parameter in PhilAccountFactory for local tests.
///      The empty ticket means all STARK-gated scopes would fail, but since
///      starkScopeMask defaults to 0, no scopes require STARK unlock in base config.
contract MockUnlockInbox {
    struct Ticket {
        uint64 nonce;
        uint32 validAfter;
        uint32 validUntil;
        uint32 scope;
        bytes32 constraintsHash;
    }

    /// @notice Always returns an empty ticket (zero values = no active unlock).
    function getTicket(address) external pure returns (Ticket memory) {
        return Ticket(0, 0, 0, 0, bytes32(0));
    }
}
