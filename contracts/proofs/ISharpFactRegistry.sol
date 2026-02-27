// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISharpFactRegistry
/// @notice Interface for the StarkWare SHARP (Shared Prover) fact registry.
/// @dev The production SHARP fact registry is deployed by StarkWare.
///      A fact is a bytes32 value = keccak256(abi.encode(programHash, keccak256(abi.encodePacked(outputs))))
///      where outputs is the array of public values output by the Cairo program.
///
///      Production SHARP fact registry addresses:
///        Mainnet:  0x47312450B3Ac8b5b8e247a6bB6d523e7a9E80E50
///        Sepolia:  0x07ec0D28e50322Eb0C159B9090ecF3aeA8346DFe
///
///      Local dev: use DevProofVerifier (contracts/proofs/DevProofVerifier.sol)
///                 which implements this same interface deterministically.
interface ISharpFactRegistry {
    /// @notice Returns true if the given fact has been proven and registered by SHARP.
    /// @param fact The fact hash = keccak256(abi.encode(programHash, outputsHash))
    /// @return True if the fact is valid and registered
    function isValid(bytes32 fact) external view returns (bool);
}
