// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "solady/src/utils/ECDSA.sol";

import {ISharpFactRegistry} from "./ISharpFactRegistry.sol";

/// @notice 2FA smart account requiring owner EIP-712 signature + SHARP fact per execution.
/// @dev This contract is independent of Phil contracts.
contract SharpAccount {
    using ECDSA for bytes32;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EXECUTE_INTENT_TYPEHASH =
        keccak256("Intent(bytes32 intentHash)");
    bytes32 private constant NAME_HASH = keccak256("SharpAccountV1");
    bytes32 private constant VERSION_HASH = keccak256("1");

    // Updated by sharpAccountV1/scripts/build.mjs.
    bytes32 public constant PROGRAM_HASH =
        0x59d6a1ba2d7636d26160f58ac8a9ea59c30b03f4bd7fbb3e66eb052b3ab5d2f3;

    address public owner;
    bytes32 public secondFactorCommitment;
    uint64 public nonce;
    ISharpFactRegistry public factRegistry;

    error InvalidOwner();
    error InvalidRegistry();
    error InvalidSecondFactorCommitment();
    error InvalidTarget();
    error InvalidValue();
    error InvalidIntentHash();
    error InvalidSignature();
    error MissingSharpFact();
    error NonceOverflow();
    error CallFailed(bytes data);

    event Executed(
        address indexed target,
        uint256 value,
        uint64 indexed nonce,
        bytes32 indexed intentHash,
        bytes32 fact
    );

    constructor(address owner_, bytes32 secondFactorCommitment_, address factRegistry_) {
        if (owner_ == address(0)) revert InvalidOwner();
        if (factRegistry_ == address(0)) revert InvalidRegistry();
        if (secondFactorCommitment_ == bytes32(0)) revert InvalidSecondFactorCommitment();

        owner = owner_;
        secondFactorCommitment = secondFactorCommitment_;
        factRegistry = ISharpFactRegistry(factRegistry_);
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata signature,
        bytes32 intentHash
    ) external payable {
        if (target == address(0)) revert InvalidTarget();
        if (msg.value != value) revert InvalidValue();

        bytes32 callDataHash = keccak256(data);
        bytes32 expectedIntentHash = _intentHash(
            owner,
            address(this),
            target,
            callDataHash,
            msg.value,
            nonce,
            block.chainid,
            secondFactorCommitment
        );
        if (intentHash != expectedIntentHash) revert InvalidIntentHash();

        bytes32 digest = _toEip712Digest(intentHash);
        address recovered = ECDSA.recoverCalldata(digest, signature);
        if (recovered != owner) revert InvalidSignature();

        bytes32 fact = computeFactHash(intentHash);
        if (!factRegistry.isValid(fact)) revert MissingSharpFact();

        uint64 currentNonce = nonce;
        if (currentNonce == type(uint64).max) revert NonceOverflow();
        nonce = currentNonce + 1;

        (bool success, bytes memory result) = target.call{value: msg.value}(data);
        if (!success) revert CallFailed(result);

        emit Executed(target, msg.value, currentNonce, intentHash, fact);
    }

    function computeIntentHash(
        address target,
        bytes32 callDataHash,
        uint256 value,
        uint64 nonce_,
        uint256 chainId_
    ) external view returns (bytes32) {
        return _intentHash(
            owner,
            address(this),
            target,
            callDataHash,
            value,
            nonce_,
            chainId_,
            secondFactorCommitment
        );
    }

    function computeFactHash(bytes32 intentHash) public pure returns (bytes32) {
        return keccak256(abi.encode(PROGRAM_HASH, intentHash));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function _toEip712Digest(bytes32 intentHash) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(EXECUTE_INTENT_TYPEHASH, intentHash));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _intentHash(
        address wallet_,
        address smartAccount_,
        address target_,
        bytes32 callDataHash_,
        uint256 value_,
        uint64 nonce_,
        uint256 chainId_,
        bytes32 secondFactorCommitment_
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                wallet_,
                smartAccount_,
                target_,
                callDataHash_,
                value_,
                nonce_,
                chainId_,
                secondFactorCommitment_
            )
        );
    }
}
