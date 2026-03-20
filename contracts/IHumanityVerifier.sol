// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofGate} from "./IProofGate.sol";

/// @title IHumanityVerifier
/// @notice Provider-agnostic verifier interface for identity-eligibility proofs.
/// @dev PhilIdentityGate consumes nullifiers and claim bindings, while concrete
///      verifier implementations handle the current proof bridge mechanics.
interface IHumanityVerifier {
    function PROGRAM_HASH() external view returns (bytes32);
    function PROOF_CONTEXT() external view returns (uint256);
    function verifierConfigHash() external view returns (uint256);

    function computeExpectedFactHash(
        address recipient,
        bytes32 claimHash,
        uint256 identityNullifier,
        uint256 credentialCommitment,
        uint8 claimKind
    ) external view returns (bytes32);

    function verifyHumanityProof(
        address recipient,
        bytes32 claimHash,
        uint8 claimKind,
        IProofGate.MintProof calldata proof
    ) external view returns (uint256 identityNullifier, uint256 credentialCommitment);
}
