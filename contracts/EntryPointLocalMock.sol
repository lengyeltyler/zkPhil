// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Packed ERC-4337 UserOperation (v0.7 layout).
 */
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

interface IEntryPointLocalAccount {
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}

interface IEntryPointLocalPaymaster {
    enum PostOpMode {
        opSucceeded,
        opReverted,
        postOpReverted
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}

/**
 * @title EntryPointLocalMock
 * @notice Local-only minimal EntryPoint implementation for deterministic AA testing.
 * @dev This is not production-grade gas accounting. It exists only to make local
 *      ERC-4337 flows executable against the canonical v0.7 EntryPoint address.
 */
contract EntryPointLocalMock {
    mapping(address => mapping(uint192 => uint256)) private _nonceSequence;
    mapping(address => uint256) private _deposits;

    error FailedOp(uint256 opIndex, string reason);
    error InvalidInitCode();
    error WithdrawFailed();

    receive() external payable {
        _deposits[msg.sender] += msg.value;
    }

    function depositTo(address account) external payable {
        _deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        uint256 balance = _deposits[msg.sender];
        if (withdrawAmount > balance) revert WithdrawFailed();
        unchecked {
            _deposits[msg.sender] = balance - withdrawAmount;
        }
        (bool ok,) = withdrawAddress.call{value: withdrawAmount}("");
        if (!ok) revert WithdrawFailed();
    }

    function balanceOf(address account) external view returns (uint256) {
        return _deposits[account];
    }

    function getNonce(address sender, uint192 key) external view returns (uint256) {
        return _nonceSequence[sender][key];
    }

    function getUserOpHash(PackedUserOperation calldata userOp) public view returns (bytes32) {
        bytes32 packedHash = keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
            )
        );
        return keccak256(abi.encode(packedHash, address(this), block.chainid));
    }

    function simulateValidation(
        PackedUserOperation calldata userOp
    ) external returns (uint256 accountValidationData, uint256 paymasterValidationData) {
        if (userOp.initCode.length != 0) {
            address created = _createSender(userOp.initCode);
            if (created != userOp.sender) revert FailedOp(0, "AA14 initCode must return sender");
        }

        bytes32 userOpHash = getUserOpHash(userOp);
        accountValidationData = _validateAccount(userOp, userOpHash);
        if (userOp.paymasterAndData.length >= 20) {
            paymasterValidationData = _validatePaymaster(userOp, userOpHash);
        }
    }

    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external {
        beneficiary; // Silence unused warning in local mock.

        for (uint256 i = 0; i < ops.length; i++) {
            PackedUserOperation calldata userOp = ops[i];

            if (userOp.initCode.length != 0) {
                address created = _createSender(userOp.initCode);
                if (created != userOp.sender) revert FailedOp(i, "AA14 initCode must return sender");
            }

            uint256 expectedNonce = _nonceSequence[userOp.sender][0];
            if (userOp.nonce != expectedNonce) revert FailedOp(i, "AA25 invalid account nonce");
            _nonceSequence[userOp.sender][0] = expectedNonce + 1;

            bytes32 userOpHash = getUserOpHash(userOp);

            uint256 accountValidationData;
            uint256 paymasterValidationData;
            try this._validateForHandleOps(userOp, userOpHash) returns (
                uint256 accountData,
                uint256 paymasterData
            ) {
                accountValidationData = accountData;
                paymasterValidationData = paymasterData;
            } catch Error(string memory reason) {
                revert FailedOp(i, reason);
            } catch {
                revert FailedOp(i, "AA23 reverted");
            }

            if (_sigFailed(accountValidationData)) revert FailedOp(i, "AA24 signature error");
            if (_sigFailed(paymasterValidationData)) revert FailedOp(i, "AA34 paymaster signature error");

            (bool success, bytes memory returndata) = userOp.sender.call(userOp.callData);
            if (!success) _revertWithReason(i, returndata, "AA33 execution reverted");

            if (userOp.paymasterAndData.length >= 20) {
                address paymaster = _paymasterFromData(userOp.paymasterAndData);
                IEntryPointLocalPaymaster(paymaster).postOp(
                    IEntryPointLocalPaymaster.PostOpMode.opSucceeded,
                    "",
                    0,
                    0
                );
            }
        }
    }

    function _validateForHandleOps(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256 accountValidationData, uint256 paymasterValidationData) {
        require(msg.sender == address(this), "self only");
        accountValidationData = _validateAccount(userOp, userOpHash);
        if (userOp.paymasterAndData.length >= 20) {
            paymasterValidationData = _validatePaymaster(userOp, userOpHash);
        }
    }

    function _validateAccount(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal returns (uint256 validationData) {
        validationData = IEntryPointLocalAccount(userOp.sender).validateUserOp(userOp, userOpHash, 0);
    }

    function _validatePaymaster(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal returns (uint256 validationData) {
        address paymaster = _paymasterFromData(userOp.paymasterAndData);
        (, validationData) = IEntryPointLocalPaymaster(paymaster).validatePaymasterUserOp(userOp, userOpHash, 0);
    }

    function _createSender(bytes calldata initCode) internal returns (address sender) {
        if (initCode.length < 20) revert InvalidInitCode();
        address factory = address(bytes20(initCode[0:20]));
        bytes calldata factoryCallData = initCode[20:];
        (bool success, bytes memory ret) = factory.call(factoryCallData);
        if (!success || ret.length < 32) return address(0);
        sender = abi.decode(ret, (address));
    }

    function _paymasterFromData(bytes calldata paymasterAndData) internal pure returns (address) {
        return address(bytes20(paymasterAndData[0:20]));
    }

    function _sigFailed(uint256 validationData) internal pure returns (bool) {
        return uint160(validationData) == 1;
    }

    function _revertWithReason(
        uint256 opIndex,
        bytes memory returndata,
        string memory fallbackReason
    ) internal pure {
        if (returndata.length >= 68) {
            assembly {
                returndata := add(returndata, 0x04)
            }
            revert FailedOp(opIndex, abi.decode(returndata, (string)));
        }
        revert FailedOp(opIndex, fallbackReason);
    }
}
