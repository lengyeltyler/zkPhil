// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofGate} from "../IProofGate.sol";
import {IHumanityVerifier} from "../IHumanityVerifier.sol";
import {ISharpFactRegistry} from "./ISharpFactRegistry.sol";

/// @title MockHumanityVerifier
/// @notice DEV/TEST-ONLY fact-registry-backed verifier for mock humanity proofs.
/// @dev This contract intentionally exists only for local development on chainId
///      31337. It is not World ID, does not call external humanity services,
///      and must never be treated as production verification.
contract MockHumanityVerifier is IHumanityVerifier {
    uint256 private constant LOCAL_CHAIN_ID = 31337;

    bytes32 public immutable PROGRAM_HASH;
    uint256 public immutable PROOF_CONTEXT;

    address public owner;
    ISharpFactRegistry public factRegistry;
    uint256 public verifierConfigHash;

    event FactRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event VerifierConfigHashUpdated(uint256 previousConfigHash, uint256 newConfigHash);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error InvalidFactHash();
    error MissingRegisteredFact();
    error ProofExpired();
    error NotOwner();
    error InvalidOwner();
    error InvalidFactRegistry();
    error InvalidProofMetadata();
    error NotLocalChain(uint256 chainId);

    struct DecodedProofMetadata {
        uint256 identityNullifier;
        uint256 credentialCommitment;
    }

    constructor(
        bytes32 programHash_,
        uint256 proofContext_,
        address factRegistry_,
        uint256 verifierConfigHash_
    ) {
        if (block.chainid != LOCAL_CHAIN_ID) revert NotLocalChain(block.chainid);
        if (factRegistry_ == address(0)) revert InvalidFactRegistry();

        PROGRAM_HASH = programHash_;
        PROOF_CONTEXT = proofContext_;
        owner = msg.sender;
        factRegistry = ISharpFactRegistry(factRegistry_);
        verifierConfigHash = verifierConfigHash_;

        emit OwnershipTransferred(address(0), msg.sender);
        emit FactRegistryUpdated(address(0), factRegistry_);
        emit VerifierConfigHashUpdated(0, verifierConfigHash_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setFactRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert InvalidFactRegistry();
        address previousRegistry = address(factRegistry);
        factRegistry = ISharpFactRegistry(newRegistry);
        emit FactRegistryUpdated(previousRegistry, newRegistry);
    }

    function setVerifierConfigHash(uint256 newConfigHash) external onlyOwner {
        uint256 previousConfigHash = verifierConfigHash;
        verifierConfigHash = newConfigHash;
        emit VerifierConfigHashUpdated(previousConfigHash, newConfigHash);
    }

    function computeExpectedFactHash(
        address recipient,
        bytes32 claimHash,
        uint256 identityNullifier,
        uint256 credentialCommitment,
        uint8 claimKind
    ) public view override returns (bytes32) {
        uint256 claimHashHi = uint256(claimHash) >> 128;
        uint256 claimHashLo = uint128(uint256(claimHash));
        bytes32 outputsHash = keccak256(
            abi.encodePacked(
                verifierConfigHash,
                PROOF_CONTEXT,
                uint256(uint160(recipient)),
                claimHashHi,
                claimHashLo,
                identityNullifier,
                credentialCommitment,
                uint256(claimKind)
            )
        );
        return keccak256(abi.encode(PROGRAM_HASH, outputsHash));
    }

    function verifyHumanityProof(
        address recipient,
        bytes32 claimHash,
        uint8 claimKind,
        IProofGate.MintProof calldata proof
    ) external view override returns (uint256 identityNullifier, uint256 credentialCommitment) {
        if (proof.expiry != 0 && block.timestamp > proof.expiry) revert ProofExpired();

        DecodedProofMetadata memory metadata = _decodeProofMetadata(proof.signature);
        bytes32 expectedFactHash = computeExpectedFactHash(
            recipient,
            claimHash,
            metadata.identityNullifier,
            metadata.credentialCommitment,
            claimKind
        );
        if (expectedFactHash != proof.factHash) revert InvalidFactHash();
        if (!factRegistry.isValid(proof.factHash)) revert MissingRegisteredFact();

        return (metadata.identityNullifier, metadata.credentialCommitment);
    }

    function _decodeProofMetadata(bytes calldata encoded)
        internal
        pure
        returns (DecodedProofMetadata memory metadata)
    {
        if (encoded.length != 64) revert InvalidProofMetadata();
        (metadata.identityNullifier, metadata.credentialCommitment) =
            abi.decode(encoded, (uint256, uint256));
    }
}
