// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IProofGate
/// @notice Interface for backend-signed proof verification gate
interface IProofGate {
    struct MintProof {
        // 0 means no expiry.
        uint256 expiry;
        // Deterministic fact hash binding proof + mint intent.
        bytes32 factHash;
        // Signature by the backend signer over the claim hash.
        bytes signature;
    }

    /// @notice Verify proof payload and consume nullifier.
    /// @dev Reverts if the proof is invalid, expired, malformed, or replayed.
    function verifyAndConsume(
        address recipient,
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed,
        MintProof calldata proof
    ) external;

    /// @notice Verify proof payload against a generic action hash and consume its nullifier.
    /// @dev Used by smart-account create/execute and cadence mint flows.
    function verifyActionAndConsume(
        address recipient,
        uint8 actionType,
        bytes32 actionHash,
        MintProof calldata proof
    ) external;

    /// @notice Check if a nullifier has been used
    /// @param nullifier The nullifier to check
    /// @return True if the nullifier has been consumed
    function nullifierUsed(bytes32 nullifier) external view returns (bool);

    /// @notice Check if a mint-proof nullifier has already been consumed
    function isMintNullifierSpent(
        address recipient,
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed,
        bytes32 factHash
    ) external view returns (bool);

    /// @notice Check if an action-proof nullifier has already been consumed
    function isActionNullifierSpent(
        address recipient,
        uint8 actionType,
        bytes32 factHash
    ) external view returns (bool);
}
