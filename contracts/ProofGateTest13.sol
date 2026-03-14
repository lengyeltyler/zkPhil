// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofGate} from "./IProofGate.sol";
import {ECDSA} from "solady/src/utils/ECDSA.sol";

/// @title ProofGateTest13
/// @notice Backend-signed proof verifier for Phil flows.
contract ProofGateTest13 is IProofGate {
    using ECDSA for bytes32;

    uint8 public constant ACTION_MINT = 1;
    uint8 public constant ACTION_ACCOUNT_CREATE = 2;
    uint8 public constant ACTION_CADENCE_MINT = 4;
    uint8 public constant ACTION_CADENCE_RESERVE = 5;

    // -----------------------------------------------------------------
    // Immutables
    // -----------------------------------------------------------------

    /// @notice Program hash namespace used when deriving local fact hashes.
    bytes32 public immutable PROGRAM_HASH;

    /// @notice Unique identifier for this drop
    uint256 public immutable DROP_ID;
    bytes4 internal constant FACT_TAG = bytes4(keccak256("FACT_V1"));
    bytes4 internal constant NULLIFIER_TAG = bytes4(keccak256("NULL_V1"));

    // -----------------------------------------------------------------
    // State
    // -----------------------------------------------------------------

    /// @notice Owner controlling authorized callers.
    address public owner;

    /// @notice Contracts allowed to consume proofs.
    mapping(address => bool) public authorizedCaller;

    /// @notice Backend signer authorized to attest allowlist eligibility.
    address public allowlistSigner;

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
    event AllowlistSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------

    error NullifierAlreadyUsed();
    error InvalidFactHash();
    error InvalidSignature();
    error ProofExpired();
    error UnauthorizedCaller();
    error NotOwner();
    error InvalidAuthorizedCaller();
    error InvalidActionType();
    error InvalidAllowlistSigner();

    // -----------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------

    /// @param programHash_ Local prover program hash namespace
    /// @param dropId_ Unique identifier for this drop
    /// @param initialAuthorizedCaller_ First contract allowed to consume proofs
    constructor(
        bytes32 programHash_,
        uint256 dropId_,
        address initialAuthorizedCaller_
    ) {
        if (initialAuthorizedCaller_ == address(0)) revert InvalidAuthorizedCaller();

        PROGRAM_HASH = programHash_;
        DROP_ID = dropId_;
        owner = msg.sender;
        allowlistSigner = msg.sender;
        authorizedCaller[initialAuthorizedCaller_] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit AllowlistSignerUpdated(address(0), msg.sender);
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

    function setAllowlistSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidAllowlistSigner();
        address previousSigner = allowlistSigner;
        allowlistSigner = newSigner;
        emit AllowlistSignerUpdated(previousSigner, newSigner);
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

        _verifyBackendMintProof(claimHash, proof);

        bytes32 nullifier = computeMintNullifier(
            recipient,
            mintTo,
            philId,
            paletteVariant,
            mixMode,
            mixSeed,
            proof.factHash
        );
        _consumeNullifier(nullifier, recipient, proof.factHash, ACTION_MINT, mintActionHash);
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
        _verifyBackendProof(claimHash, proof);

        bytes32 nullifier = computeActionNullifier(recipient, actionType, proof.factHash);
        _consumeNullifier(nullifier, recipient, proof.factHash, actionType, actionHash);
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
                PROGRAM_HASH,
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
                PROGRAM_HASH,
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

    function computeExpectedFactHash(bytes32 claimHash) public pure returns (bytes32) {
        return keccak256(abi.encode(FACT_TAG, claimHash));
    }

    function computeMintNullifier(
        address recipient,
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed,
        bytes32 factHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                NULLIFIER_TAG,
                recipient,
                mintTo,
                philId,
                paletteVariant,
                mixMode,
                mixSeed,
                factHash
            )
        );
    }

    function computeActionNullifier(
        address recipient,
        uint8 actionType,
        bytes32 factHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(recipient, actionType, factHash));
    }

    function isMintNullifierSpent(
        address recipient,
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed,
        bytes32 factHash
    ) external view returns (bool) {
        return nullifierUsed[
            computeMintNullifier(
                recipient,
                mintTo,
                philId,
                paletteVariant,
                mixMode,
                mixSeed,
                factHash
            )
        ];
    }

    function isActionNullifierSpent(
        address recipient,
        uint8 actionType,
        bytes32 factHash
    ) external view returns (bool) {
        return nullifierUsed[computeActionNullifier(recipient, actionType, factHash)];
    }

    function _verifyBackendMintProof(bytes32 claimHash, MintProof calldata proof) internal view {
        _verifyBackendProof(claimHash, proof);
    }

    function _verifyBackendProof(bytes32 claimHash, MintProof calldata proof) internal view {
        if (proof.expiry != 0 && block.timestamp > proof.expiry) revert ProofExpired();

        bytes32 expectedFactHash = computeExpectedFactHash(claimHash);
        if (expectedFactHash != proof.factHash) revert InvalidFactHash();

        address recovered = ECDSA.recoverCalldata(claimHash.toEthSignedMessageHash(), proof.signature);
        if (recovered != allowlistSigner) revert InvalidSignature();
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
