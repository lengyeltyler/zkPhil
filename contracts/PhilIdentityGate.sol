// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IProofGate} from "./IProofGate.sol";
import {IHumanityVerifier} from "./IHumanityVerifier.sol";

/// @title PhilIdentityGate
/// @notice Identity gate that consumes provider-agnostic humanity proofs.
/// @dev The gate is responsible only for claim binding, caller authorization,
///      and one-identity-per-nullifier replay protection. The current
///      fact-registry bridge lives behind `humanityVerifier`.
contract PhilIdentityGate is IProofGate {
    uint8 public constant ACTION_MINT = 1;
    uint8 public constant ACTION_ACCOUNT_CREATE = 2;
    uint8 public constant ACTION_CADENCE_MINT = 4;
    uint8 public constant ACTION_CADENCE_RESERVE = 5;

    address public owner;
    IHumanityVerifier public humanityVerifier;
    mapping(address => bool) public authorizedCaller;
    mapping(bytes32 => bool) public nullifierUsed;

    event NullifierConsumed(
        bytes32 indexed nullifier,
        address indexed recipient,
        bytes32 indexed factHash,
        uint8 actionType,
        bytes32 actionHash
    );
    event AuthorizedCallerUpdated(address indexed caller, bool allowed);
    event HumanityVerifierUpdated(address indexed previousVerifier, address indexed newVerifier);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NullifierAlreadyUsed();
    error ProofExpired();
    error UnauthorizedCaller();
    error NotOwner();
    error InvalidAuthorizedCaller();
    error InvalidActionType();
    error InvalidHumanityVerifier();

    constructor(address humanityVerifier_, address initialAuthorizedCaller_) {
        if (humanityVerifier_ == address(0)) revert InvalidHumanityVerifier();
        if (initialAuthorizedCaller_ == address(0)) revert InvalidAuthorizedCaller();

        owner = msg.sender;
        humanityVerifier = IHumanityVerifier(humanityVerifier_);
        authorizedCaller[initialAuthorizedCaller_] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit HumanityVerifierUpdated(address(0), humanityVerifier_);
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

    function setHumanityVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert InvalidHumanityVerifier();
        address previousVerifier = address(humanityVerifier);
        humanityVerifier = IHumanityVerifier(newVerifier);
        emit HumanityVerifierUpdated(previousVerifier, newVerifier);
    }

    function PROGRAM_HASH() public view returns (bytes32) {
        return humanityVerifier.PROGRAM_HASH();
    }

    function PROOF_CONTEXT() public view returns (uint256) {
        return humanityVerifier.PROOF_CONTEXT();
    }

    function verifierConfigHash() public view returns (uint256) {
        return humanityVerifier.verifierConfigHash();
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
        (uint256 identityNullifier,) = humanityVerifier.verifyHumanityProof(
            recipient,
            claimHash,
            ACTION_MINT,
            proof
        );
        _consumeNullifier(_nullifierKey(identityNullifier), recipient, proof.factHash, ACTION_MINT, mintActionHash);
    }

    function verifyActionAndConsume(
        address recipient,
        uint8 actionType,
        bytes32 actionHash,
        MintProof calldata proof
    ) external override {
        _requireAuthorizedCaller();
        if (actionType == 0) revert InvalidActionType();
        if (proof.expiry != 0 && block.timestamp > proof.expiry) revert ProofExpired();

        bytes32 claimHash = computeActionClaimHash(recipient, actionType, actionHash, proof.expiry);
        (uint256 identityNullifier,) = humanityVerifier.verifyHumanityProof(
            recipient,
            claimHash,
            actionType,
            proof
        );
        _consumeNullifier(_nullifierKey(identityNullifier), recipient, proof.factHash, actionType, actionHash);
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
                PROGRAM_HASH(),
                PROOF_CONTEXT(),
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
                PROGRAM_HASH(),
                PROOF_CONTEXT(),
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
        uint256 identityNullifier,
        uint256 credentialCommitment,
        uint8 claimKind
    ) public view returns (bytes32) {
        return humanityVerifier.computeExpectedFactHash(
            recipient,
            claimHash,
            identityNullifier,
            credentialCommitment,
            claimKind
        );
    }

    function isNullifierSpent(uint256 nullifier) external view override returns (bool) {
        return nullifierUsed[_nullifierKey(nullifier)];
    }

    function _requireAuthorizedCaller() internal view {
        if (!authorizedCaller[msg.sender]) revert UnauthorizedCaller();
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
