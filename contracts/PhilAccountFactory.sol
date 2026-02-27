// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4337Factory} from "solady/src/accounts/ERC4337Factory.sol";
import {IProofGate} from "./IProofGate.sol";

interface IPhilAccountInit {
    function initialize(address newOwner) external payable;
    function initVaultConfig(address unlockInbox_, address philTestMint_, address proofVerifier_) external;
}

/// @title PhilAccountFactory
/// @notice Deterministic CREATE2 factory for PhilAccount smart accounts.
/// @dev Account creation is proof-gated through ProofGateTest13 ACTION_ACCOUNT_CREATE.
contract PhilAccountFactory is ERC4337Factory {
    uint8 internal constant ACTION_ACCOUNT_CREATE = 2;
    uint8 internal constant ACTION_ACCOUNT_EXECUTE = 3;

    // ─────────────────────────────────────────────────────────────
    // Immutables
    // ─────────────────────────────────────────────────────────────

    /// @notice Unlock inbox address (L1) for STARK unlock tickets
    address public immutable unlockInbox;

    /// @notice PhilTestMint contract address
    address public immutable philTestMint;

    /// @notice Shared proof gate used across mint and account paths
    IProofGate public immutable proofGate;

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    /// @notice Tracks deterministic accounts created by this factory.
    mapping(address => bool) public isPhilAccount;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event PhilAccountCreated(
        address indexed account,
        address indexed owner,
        uint256 starkPubKeyX
    );

    event ExecutionProofConsumed(
        address indexed account,
        address indexed recipient,
        bytes32 indexed actionHash,
        bytes32 factHash
    );

    error AccountDeployFailed();
    error UnknownPhilAccount();
    error ProofRequired();

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    /// @param implementation_ The PhilAccount implementation contract address
    /// @param unlockInbox_ The L1 unlock inbox address
    /// @param philTestMint_ The PhilTestMint contract address
    /// @param proofGate_ The shared proof gate contract
    constructor(
        address implementation_,
        address unlockInbox_,
        address philTestMint_,
        address proofGate_
    ) payable ERC4337Factory(implementation_) {
        unlockInbox = unlockInbox_;
        philTestMint = philTestMint_;
        proofGate = IProofGate(proofGate_);
    }

    // ─────────────────────────────────────────────────────────────
    // PhilAccount-specific deploy
    // ─────────────────────────────────────────────────────────────

    /// @notice Legacy create entrypoint intentionally disabled.
    function createPhilAccount(
        address,
        uint256
    ) external payable returns (address) {
        revert ProofRequired();
    }

    /// @notice Deploy a PhilAccount for the given owner and STARK key with proof gating.
    /// @param owner The EOA address that co-signs transactions
    /// @param starkPubKeyX The STARK public key X-coordinate
    /// @param proof Shared proof payload consumed by ProofGateTest13
    /// @return account The deployed (or existing) account address
    function createPhilAccount(
        address owner,
        uint256 starkPubKeyX,
        IProofGate.MintProof calldata proof
    ) public payable returns (address account) {
        bytes32 actionHash = computeCreateActionHash(owner, starkPubKeyX);
        proofGate.verifyActionAndConsume(owner, ACTION_ACCOUNT_CREATE, actionHash, proof);

        bytes32 salt = computeSalt(owner, starkPubKeyX);
        account = getAddress(salt);
        if (account.code.length == 0) {
            account = _deployProxy(salt);
            IPhilAccountInit(account).initialize{value: msg.value}(owner);
        } else if (msg.value != 0) {
            (bool valueForwarded,) = account.call{value: msg.value}("");
            require(valueForwarded, "ETH transfer failed");
        }

        isPhilAccount[account] = true;

        // Configure vault inbox + mint target + proof verifier if not already set
        (bool success, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("unlockInbox()")
        );
        if (success && data.length >= 32) {
            address currentInbox = abi.decode(data, (address));
            if (currentInbox == address(0)) {
                (success,) = account.call(
                    abi.encodeWithSignature(
                        "initVaultConfig(address,address,address)",
                        unlockInbox,
                        philTestMint,
                        address(this)
                    )
                );
                require(success, "initVaultConfig failed");
                emit PhilAccountCreated(account, owner, starkPubKeyX);
            }
        }
    }

    /// @notice Called by PhilAccount contracts to consume ACTION_ACCOUNT_EXECUTE proofs.
    function consumeExecutionProof(
        address recipient,
        bytes32 actionHash,
        IProofGate.MintProof calldata proof
    ) external {
        if (!isPhilAccount[msg.sender]) revert UnknownPhilAccount();
        proofGate.verifyActionAndConsume(recipient, ACTION_ACCOUNT_EXECUTE, actionHash, proof);
        emit ExecutionProofConsumed(msg.sender, recipient, actionHash, proof.factHash);
    }

    /// @notice Claim hash action binding for account creation.
    function computeCreateActionHash(
        address owner,
        uint256 starkPubKeyX
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), owner, starkPubKeyX));
    }

    /// @notice Predict the deterministic address for a given owner and STARK key
    /// @param owner The EOA address
    /// @param starkPubKeyX The STARK public key X-coordinate
    /// @return The predicted account address
    function getPhilAddress(
        address owner,
        uint256 starkPubKeyX
    ) public view returns (address) {
        bytes32 salt = computeSalt(owner, starkPubKeyX);
        return getAddress(salt);
    }

    // ─────────────────────────────────────────────────────────────
    // Salt computation
    // ─────────────────────────────────────────────────────────────

    /// @dev Compute the deterministic salt from owner + starkPubKeyX.
    ///      First 20 bytes = owner address (required by LibClone.checkStartsWith).
    ///      Last 12 bytes = truncated hash of starkPubKeyX.
    function computeSalt(
        address owner,
        uint256 starkPubKeyX
    ) public pure returns (bytes32) {
        return bytes32(
            (uint256(uint160(owner)) << 96) |
            uint96(uint256(keccak256(abi.encode(starkPubKeyX))))
        );
    }

    function getAddress(bytes32 salt) public view override returns (address) {
        return _predictProxyAddress(salt);
    }

    function _predictProxyAddress(bytes32 salt) internal view returns (address) {
        bytes32 bytecodeHash = keccak256(_proxyCreationCode());
        bytes32 digest = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                bytecodeHash
            )
        );
        return address(uint160(uint256(digest)));
    }

    function _deployProxy(bytes32 salt) internal returns (address proxy) {
        bytes memory code = _proxyCreationCode();
        assembly ("memory-safe") {
            proxy := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (proxy == address(0)) revert AccountDeployFailed();
    }

    function _proxyCreationCode() internal view returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
