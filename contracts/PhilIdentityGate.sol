// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofGate} from "./IProofGate.sol";
import {ISharpFactRegistry} from "./proofs/ISharpFactRegistry.sol";

/// @title PhilIdentityGate
/// @notice Fact-registry-backed eligibility verifier for Phil identity issuance flows.
/// @dev The client proves an eligibility claim locally, then a registry
///      acknowledges the resulting fact hash. This contract only consumes
///      registered facts and never trusts a backend signer for authorization.
contract PhilIdentityGate is IProofGate {
    uint8 public constant ACTION_MINT = 1;
    uint8 public constant ACTION_ACCOUNT_CREATE = 2;
    uint8 public constant ACTION_CADENCE_MINT = 4;
    uint8 public constant ACTION_CADENCE_RESERVE = 5;

    bytes32 public immutable PROGRAM_HASH;
    uint256 public immutable CONTEXT_ID;

    address public owner;
    mapping(address => bool) public authorizedCaller;
    mapping(bytes32 => bool) public nullifierUsed;

    ISharpFactRegistry public factRegistry;
    uint256 public eligibilityRoot;

    event NullifierConsumed(
        bytes32 indexed nullifier,
        address indexed recipient,
        bytes32 indexed factHash,
        uint8 actionType,
        bytes32 actionHash
    );
    event AuthorizedCallerUpdated(address indexed caller, bool allowed);
    event FactRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event EligibilityRootUpdated(uint256 previousRoot, uint256 newRoot);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NullifierAlreadyUsed();
    error InvalidFactHash();
    error MissingRegisteredFact();
    error ProofExpired();
    error UnauthorizedCaller();
    error NotOwner();
    error InvalidAuthorizedCaller();
    error InvalidActionType();
    error InvalidFactRegistry();
    error InvalidProofMetadata();

    struct DecodedProofMetadata {
        uint256 nullifier;
        uint256 credentialSlot;
        uint256 credentialLeaf;
    }

    constructor(
        bytes32 programHash_,
        uint256 contextId_,
        address factRegistry_,
        uint256 eligibilityRoot_,
        address initialAuthorizedCaller_
    ) {
        if (factRegistry_ == address(0)) revert InvalidFactRegistry();
        if (initialAuthorizedCaller_ == address(0)) revert InvalidAuthorizedCaller();

        PROGRAM_HASH = programHash_;
        CONTEXT_ID = contextId_;
        owner = msg.sender;
        factRegistry = ISharpFactRegistry(factRegistry_);
        eligibilityRoot = eligibilityRoot_;
        authorizedCaller[initialAuthorizedCaller_] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit FactRegistryUpdated(address(0), factRegistry_);
        emit EligibilityRootUpdated(0, eligibilityRoot_);
        emit AuthorizedCallerUpdated(initialAuthorizedCaller_, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAuthorizedCaller();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setAuthorizedCaller(address caller, bool allowed) external onlyOwner {
        if (caller == address(0)) revert InvalidAuthorizedCaller();
        authorizedCaller[caller] = allowed;
        emit AuthorizedCallerUpdated(caller, allowed);
    }

    function setFactRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert InvalidFactRegistry();
        address previousRegistry = address(factRegistry);
        factRegistry = ISharpFactRegistry(newRegistry);
        emit FactRegistryUpdated(previousRegistry, newRegistry);
    }

    function setEligibilityRoot(uint256 newRoot) external onlyOwner {
        uint256 previousRoot = eligibilityRoot;
        eligibilityRoot = newRoot;
        emit EligibilityRootUpdated(previousRoot, newRoot);
    }

    function verifyAndConsume(
        address recipient,
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed,
        MintProof calldata proof
    ) external override {
        _requireAuthorizedCaller();

        bytes32 mintActionHash = computeMintActionHash(mintTo, philId, paletteVariant, mixMode, mixSeed);
        bytes32 claimHash = computeClaimHash(
            recipient,
            mintTo,
            philId,
            paletteVariant,
            mixMode,
            mixSeed,
            proof.expiry
        );
        DecodedProofMetadata memory metadata = _verifyFactProof(
            recipient,
            claimHash,
            ACTION_MINT,
            proof
        );
        _consumeNullifier(_nullifierKey(metadata.nullifier), recipient, proof.factHash, ACTION_MINT, mintActionHash);
    }

    function verifyActionAndConsume(
        address recipient,
        uint8 actionType,
        bytes32 actionHash,
        MintProof calldata proof
    ) external override {
        _requireAuthorizedCaller();
        if (actionType == 0) revert InvalidActionType();

        bytes32 claimHash = computeActionClaimHash(recipient, actionType, actionHash, proof.expiry);
        DecodedProofMetadata memory metadata = _verifyFactProof(
            recipient,
            claimHash,
            actionType,
            proof
        );
        _consumeNullifier(_nullifierKey(metadata.nullifier), recipient, proof.factHash, actionType, actionHash);
    }

    function computeMintActionHash(
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(mintTo, philId, paletteVariant, mixMode, mixSeed));
    }

    function computeClaimHash(
        address recipient,
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed,
        uint256 expiry
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                PROGRAM_HASH,
                CONTEXT_ID,
                block.chainid,
                address(this),
                recipient,
                mintTo,
                philId,
                paletteVariant,
                mixMode,
                mixSeed,
                expiry
            )
        );
    }

    function computeActionClaimHash(
        address recipient,
        uint8 actionType,
        bytes32 actionHash,
        uint256 expiry
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                PROGRAM_HASH,
                CONTEXT_ID,
                block.chainid,
                address(this),
                recipient,
                actionType,
                actionHash,
                expiry
            )
        );
    }

    function computeExpectedFactHash(
        address recipient,
        bytes32 claimHash,
        uint256 nullifier,
        uint256 credentialSlot,
        uint256 credentialLeaf,
        uint8 claimKind
    ) public view returns (bytes32) {
        uint256 claimHashHi = uint256(claimHash) >> 128;
        uint256 claimHashLo = uint128(uint256(claimHash));
        bytes32 outputsHash = keccak256(
            abi.encodePacked(
                eligibilityRoot,
                CONTEXT_ID,
                uint256(uint160(recipient)),
                claimHashHi,
                claimHashLo,
                nullifier,
                credentialSlot,
                credentialLeaf,
                uint256(claimKind)
            )
        );
        return keccak256(abi.encode(PROGRAM_HASH, outputsHash));
    }

    function isNullifierSpent(uint256 nullifier) external view override returns (bool) {
        return nullifierUsed[_nullifierKey(nullifier)];
    }

    function _requireAuthorizedCaller() internal view {
        if (!authorizedCaller[msg.sender]) revert UnauthorizedCaller();
    }

    function _verifyFactProof(
        address recipient,
        bytes32 claimHash,
        uint8 claimKind,
        MintProof calldata proof
    ) internal view returns (DecodedProofMetadata memory metadata) {
        if (proof.expiry != 0 && block.timestamp > proof.expiry) revert ProofExpired();

        metadata = _decodeProofMetadata(proof.signature);
        bytes32 expectedFactHash = computeExpectedFactHash(
            recipient,
            claimHash,
            metadata.nullifier,
            metadata.credentialSlot,
            metadata.credentialLeaf,
            claimKind
        );
        if (expectedFactHash != proof.factHash) revert InvalidFactHash();
        if (!factRegistry.isValid(proof.factHash)) revert MissingRegisteredFact();
    }

    function _decodeProofMetadata(bytes calldata encoded)
        internal
        pure
        returns (DecodedProofMetadata memory metadata)
    {
        if (encoded.length != 96) revert InvalidProofMetadata();
        (metadata.nullifier, metadata.credentialSlot, metadata.credentialLeaf) =
            abi.decode(encoded, (uint256, uint256, uint256));
    }

    function _nullifierKey(uint256 nullifier) internal pure returns (bytes32) {
        return bytes32(nullifier);
    }

    function _consumeNullifier(
        bytes32 nullifier,
        address recipient,
        bytes32 factHash,
        uint8 actionType,
        bytes32 actionHash
    ) internal {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        nullifierUsed[nullifier] = true;
        emit NullifierConsumed(nullifier, recipient, factHash, actionType, actionHash);
    }
}
