// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "solady/src/utils/ECDSA.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";

/// @title PhilPaymaster
/// @notice ERC-4337 v0.7.0 Verifying Paymaster for sponsoring Phil NFT mints
/// @dev Validates a backend-signed sponsorship approval per UserOp.
///      Only sponsors calls to the PhilTestMint contract.
///
///      paymasterAndData layout (after the 20-byte paymaster address):
///        [0:16]   validUntil  (uint128, big-endian)
///        [16:32]  validAfter  (uint128, big-endian)
///        [32:97]  signature   (65 bytes, ECDSA)
contract PhilPaymaster is Ownable {
    // ─────────────────────────────────────────────────────────────
    // ERC-4337 v0.7.0 Structs
    // ─────────────────────────────────────────────────────────────

    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }

    enum PostOpMode {
        opSucceeded,
        opReverted,
        postOpReverted
    }

    // ─────────────────────────────────────────────────────────────
    // Immutables
    // ─────────────────────────────────────────────────────────────

    /// @notice The canonical ERC-4337 v0.7.0 EntryPoint
    address public immutable entryPoint;

    /// @notice Address that signs sponsorship approvals
    address public immutable verifyingSigner;

    /// @notice Only sponsor mints to this contract
    address public immutable philTestMint;

    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant MINT_SELECTOR = bytes4(
        keccak256("mint(address,address,uint8,uint8,uint8,uint8,uint8,uint8,bytes32,uint256[6])")
    );

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error OnlyEntryPoint();
    error InvalidPaymasterData();

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    /// @param entryPoint_ The EntryPoint v0.7.0 address
    /// @param verifyingSigner_ The backend signer for sponsorship approvals
    /// @param philTestMint_ The PhilTestMint contract to restrict sponsorship to
    constructor(
        address entryPoint_,
        address verifyingSigner_,
        address philTestMint_
    ) payable {
        _initializeOwner(msg.sender);
        entryPoint = entryPoint_;
        verifyingSigner = verifyingSigner_;
        philTestMint = philTestMint_;
    }

    // ─────────────────────────────────────────────────────────────
    // ERC-4337 Paymaster interface
    // ─────────────────────────────────────────────────────────────

    /// @dev Called by EntryPoint during validation phase.
    ///      Verifies that the sponsorship was approved by the backend signer.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) external view returns (bytes memory context, uint256 validationData) {
        if (msg.sender != entryPoint) revert OnlyEntryPoint();

        // Decode paymaster-specific data (after the 20-byte paymaster address)
        bytes calldata pmData = userOp.paymasterAndData[20:];
        if (pmData.length < 97) revert InvalidPaymasterData();

        uint128 validUntil = uint128(bytes16(pmData[0:16]));
        uint128 validAfter = uint128(bytes16(pmData[16:32]));
        bytes calldata signature = pmData[32:97];

        // Build the hash that the backend signer signed
        bytes32 hash = _getHash(userOp, validUntil, validAfter);
        bytes32 ethSignedHash = ECDSA.toEthSignedMessageHash(hash);
        address recovered = ECDSA.recoverCalldata(ethSignedHash, signature);

        // 1. Verify backend signature first.
        if (recovered != verifyingSigner) {
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        // 2. Then enforce mint policy (defense-in-depth on top of backend checks).
        if (!_isSponsoredMint(userOp)) {
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        // 3. Both checks passed.
        return ("", _packValidationData(false, validUntil, validAfter));
    }

    /// @dev Called by EntryPoint after execution. No post-op logic needed.
    function postOp(
        PostOpMode,
        bytes calldata,
        uint256,
        uint256
    ) external view {
        if (msg.sender != entryPoint) revert OnlyEntryPoint();
        // No-op: simple sponsorship model, no refunds
    }

    // ─────────────────────────────────────────────────────────────
    // Hash computation
    // ─────────────────────────────────────────────────────────────

    /// @dev Compute the hash that the backend signer must sign.
    ///      Includes all UserOp fields (minus signature & paymasterAndData sig)
    ///      plus the validity window and chain context.
    function _getHash(
        PackedUserOperation calldata userOp,
        uint128 validUntil,
        uint128 validAfter
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                block.chainid,
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    /// @dev Public version for off-chain hash computation
    function getHash(
        PackedUserOperation calldata userOp,
        uint128 validUntil,
        uint128 validAfter
    ) public view returns (bytes32) {
        return _getHash(userOp, validUntil, validAfter);
    }

    /// @notice Public helper for policy simulation/debugging.
    function isSponsoredMint(PackedUserOperation calldata userOp) external view returns (bool) {
        return _sponsorshipCheckReason(userOp) == 0;
    }

    /// @notice Returns 0 when policy passes; otherwise a non-zero failure code.
    function sponsorshipCheckReason(PackedUserOperation calldata userOp) external view returns (uint8) {
        return _sponsorshipCheckReason(userOp);
    }

    function _isSponsoredMint(PackedUserOperation calldata userOp) internal view returns (bool) {
        return _sponsorshipCheckReason(userOp) == 0;
    }

    function _sponsorshipCheckReason(PackedUserOperation calldata userOp) internal view returns (uint8) {
        bytes calldata callData = userOp.callData;
        if (callData.length < 4 + 32 * 4) return 1;
        if (bytes4(callData[0:4]) != EXECUTE_SELECTOR) return 2;

        address target = address(uint160(uint256(bytes32(callData[4:36]))));
        uint256 value = uint256(bytes32(callData[36:68]));
        if (target != philTestMint) return 3;
        if (value != 0) return 4;

        uint256 dataOffset = uint256(bytes32(callData[68:100]));
        uint256 dataLengthPos = 4 + dataOffset;
        if (callData.length < dataLengthPos + 32) return 1;

        uint256 innerLength = uint256(bytes32(callData[dataLengthPos:dataLengthPos + 32]));
        uint256 innerStart = dataLengthPos + 32;
        if (callData.length < innerStart + innerLength) return 1;
        if (innerLength != 4 + 32 * 15) return 5;

        if (bytes4(callData[innerStart:innerStart + 4]) != MINT_SELECTOR) return 6;

        address recipient = address(uint160(uint256(bytes32(callData[innerStart + 4:innerStart + 36]))));
        address mintTo = address(uint160(uint256(bytes32(callData[innerStart + 36:innerStart + 68]))));
        if (recipient == address(0)) return 7;
        if (mintTo != userOp.sender) return 8;

        return 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Validation data packing
    // ─────────────────────────────────────────────────────────────

    /// @dev Pack validation data per ERC-4337 spec:
    ///      [0:20]  aggregator address (or 0x01 for sig failure)
    ///      [20:26] validUntil (6 bytes / 48 bits)
    ///      [26:32] validAfter (6 bytes / 48 bits)
    function _packValidationData(
        bool sigFailed,
        uint128 validUntil,
        uint128 validAfter
    ) internal pure returns (uint256) {
        return
            (sigFailed ? 1 : 0) |
            (uint256(validUntil) << 160) |
            (uint256(validAfter) << (160 + 48));
    }

    // ─────────────────────────────────────────────────────────────
    // EntryPoint deposit management
    // ─────────────────────────────────────────────────────────────

    /// @notice Deposit ETH to EntryPoint to fund gas sponsorship
    function deposit() external payable onlyOwner {
        (bool success,) = entryPoint.call{value: msg.value}("");
        require(success, "deposit failed");
    }

    /// @notice Withdraw ETH from EntryPoint deposit
    /// @param to Recipient address
    /// @param amount Amount to withdraw
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        (bool success,) = entryPoint.call(
            abi.encodeWithSignature(
                "withdrawTo(address,uint256)",
                to,
                amount
            )
        );
        require(success, "withdraw failed");
    }

    /// @notice Check the paymaster's deposit balance at the EntryPoint
    function getDeposit() public view returns (uint256 result) {
        (bool success, bytes memory data) = entryPoint.staticcall(
            abi.encodeWithSignature("balanceOf(address)", address(this))
        );
        if (success && data.length >= 32) {
            result = abi.decode(data, (uint256));
        }
    }

    /// @dev Allow receiving ETH
    receive() external payable {}
}
