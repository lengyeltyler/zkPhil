// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofGate} from "./IProofGate.sol";
import {ECDSA} from "solady/src/utils/ECDSA.sol";
import {MerkleProofLib} from "solady/src/utils/MerkleProofLib.sol";

/// @title ProofGateTest13
/// @notice Local STARK-dev proof verifier + nullifier burner for Phil flows.
/// @dev Verifies merkle membership + recipient signature + deterministic fact hash.
contract ProofGateTest13 is IProofGate {
    using ECDSA for bytes32;

    uint8 public constant ACTION_MINT = 1;
    uint8 public constant ACTION_ACCOUNT_CREATE = 2;
    uint8 public constant ACTION_ACCOUNT_EXECUTE = 3;
    uint8 public constant ACTION_CADENCE_MINT = 4;
    uint8 public constant ACTION_CADENCE_RESERVE = 5;

    // -----------------------------------------------------------------
    // Immutables
    // -----------------------------------------------------------------

    /// @notice Program hash namespace used when deriving local fact hashes.
    bytes32 public immutable PROGRAM_HASH;

    /// @notice Unique identifier for this drop
    uint256 public immutable DROP_ID;

    /// @notice Merkle root for the allowlist
    bytes32 public immutable MERKLE_ROOT;

    // -----------------------------------------------------------------
    // State
    // -----------------------------------------------------------------

    /// @notice Owner controlling authorized callers.
    address public owner;

    /// @notice Contracts allowed to consume proofs.
    mapping(address => bool) public authorizedCaller;

    /// @notice Tracks consumed nullifiers to prevent replay attacks
    mapping(bytes32 => bool) public nullifierUsed;

    // -----------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------

    event NullifierConsumed(
        bytes32 indexed nullifier,
        address indexed recipient,
        bytes32 indexed factHash,
        uint8 actionType,
        bytes32 actionHash
    );
    event AuthorizedCallerUpdated(address indexed caller, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------

    error NullifierAlreadyUsed();
    error InvalidFactHash();
    error InvalidMerkleProof();
    error InvalidSignature();
    error ProofExpired();
    error UnauthorizedCaller();
    error NotOwner();
    error InvalidAuthorizedCaller();
    error InvalidActionType();

    // -----------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------

    /// @param programHash_ Local prover program hash namespace
    /// @param dropId_ Unique identifier for this drop
    /// @param merkleRoot_ Merkle root of allowlist
    /// @param initialAuthorizedCaller_ First contract allowed to consume proofs
    constructor(
        bytes32 programHash_,
        uint256 dropId_,
        bytes32 merkleRoot_,
        address initialAuthorizedCaller_
    ) {
        if (initialAuthorizedCaller_ == address(0)) revert InvalidAuthorizedCaller();

        PROGRAM_HASH = programHash_;
        DROP_ID = dropId_;
        MERKLE_ROOT = merkleRoot_;
        owner = msg.sender;
        authorizedCaller[initialAuthorizedCaller_] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit AuthorizedCallerUpdated(initialAuthorizedCaller_, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -----------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------

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

    // -----------------------------------------------------------------
    // Verification
    // -----------------------------------------------------------------

    /// @inheritdoc IProofGate
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

        _verifyAndConsume(recipient, ACTION_MINT, mintActionHash, claimHash, proof);
    }

    /// @inheritdoc IProofGate
    function verifyActionAndConsume(
        address recipient,
        uint8 actionType,
        bytes32 actionHash,
        MintProof calldata proof
    ) external override {
        _requireAuthorizedCaller();
        if (actionType == 0) revert InvalidActionType();

        bytes32 claimHash = computeActionClaimHash(recipient, actionType, actionHash, proof.expiry);
        _verifyAndConsume(recipient, actionType, actionHash, claimHash, proof);
    }

    function _verifyAndConsume(
        address recipient,
        uint8 actionType,
        bytes32 actionHash,
        bytes32 claimHash,
        MintProof calldata proof
    ) internal {
        if (proof.expiry != 0 && block.timestamp > proof.expiry) revert ProofExpired();

        bytes32 leaf = keccak256(abi.encodePacked(recipient));
        if (!MerkleProofLib.verifyCalldata(proof.merkleProof, MERKLE_ROOT, leaf)) {
            revert InvalidMerkleProof();
        }

        bytes32 expectedFactHash = computeExpectedFactHash(claimHash, proof.merkleProof);
        if (expectedFactHash != proof.factHash) revert InvalidFactHash();

        address recovered = ECDSA.recoverCalldata(claimHash.toEthSignedMessageHash(), proof.signature);
        if (recovered != recipient) revert InvalidSignature();

        bytes32 nullifier = keccak256(abi.encodePacked(recipient, actionType, proof.factHash));
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();

        nullifierUsed[nullifier] = true;

        emit NullifierConsumed(nullifier, recipient, proof.factHash, actionType, actionHash);
    }

    function _requireAuthorizedCaller() internal view {
        if (!authorizedCaller[msg.sender]) revert UnauthorizedCaller();
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
                DROP_ID,
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
                DROP_ID,
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
        bytes32 claimHash,
        bytes32[] calldata merkleProof
    ) public view returns (bytes32) {
        bytes32 witnessHash = keccak256(abi.encodePacked(merkleProof));
        return keccak256(abi.encode(PROGRAM_HASH, claimHash, MERKLE_ROOT, witnessHash));
    }
}
