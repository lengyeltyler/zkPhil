// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4337} from "solady/src/accounts/ERC4337.sol";
import {ECDSA} from "solady/src/utils/ECDSA.sol";
import {IProofGate} from "./IProofGate.sol";

interface IPhilUnlockInbox {
    struct Ticket {
        uint64 nonce;
        uint32 validAfter;
        uint32 validUntil;
        uint32 scope;
        bytes32 constraintsHash;
    }

    function getTicket(address vault) external view returns (Ticket memory);
}

interface IPhilAccountProofVerifier {
    function consumeExecutionProof(
        address recipient,
        bytes32 actionHash,
        IProofGate.MintProof calldata proof
    ) external;
}

/// @title PhilAccount
/// @notice Smart Account with owner gating + optional STARK unlock tickets for sensitive actions
/// @dev Single-signature owner auth, but blocks transfer/trading until 2 owners are set.
contract PhilAccount is ERC4337 {
    address internal constant LOCAL_ENTRY_POINT_V07 = 0x1000000000000000000000000000000000000001;
    // ─────────────────────────────────────────────────────────────
    // Scope bitmask (matches PHILVAULT.md)
    // ─────────────────────────────────────────────────────────────

    uint32 public constant S_TRANSFER_PHIL        = 1 << 0;
    uint32 public constant S_LIST_PHIL            = 1 << 1;
    uint32 public constant S_ACCEPT_BID           = 1 << 2;
    uint32 public constant S_SET_APPROVAL_FOR_ALL = 1 << 3;
    uint32 public constant S_LARGE_SPEND          = 1 << 4;
    uint32 public constant S_OWNER_CHANGE         = 1 << 5;
    uint32 public constant S_UPGRADE_WALLET       = 1 << 6;
    uint32 public constant S_ROTATE_2FA_ROOT      = 1 << 7;

    uint32 public constant MIN_OWNERS_FOR_TRADING = 2;

    // ─────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────

    mapping(address => bool) public isOwner;
    uint32 public ownerCount;

    address public unlockInbox;
    address public philTestMint;
    address public proofVerifier;
    uint32 public starkScopeMask;
    uint256 public largeSpendWei;
    mapping(bytes32 => bool) public approvedActionHash;

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error OwnerAlreadyExists();
    error OwnerNotFound();
    error MinOwnersRequired();
    error UnlockRequired();
    error InvalidUnlockTicket();
    error BadCallData();
    error ProofRequired();
    error InvalidProofVerifier();

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event UnlockInboxUpdated(address indexed inbox);
    event ProofVerifierUpdated(address indexed verifier);
    event StarkScopeMaskUpdated(uint32 mask);
    event LargeSpendUpdated(uint256 amountWei);
    event ExecutionProofSubmitted(address indexed recipient, bytes32 indexed actionHash, bytes32 indexed factHash);
    event ExecutionProofConsumed(address indexed recipient, bytes32 indexed actionHash);

    // ─────────────────────────────────────────────────────────────
    // Initialization
    // ─────────────────────────────────────────────────────────────

    /// @dev Initialize with primary owner (single-signature).
    function initialize(address newOwner) public payable override {
        _initializeOwner(newOwner);
        _addOwner(newOwner);
        if (largeSpendWei == 0) {
            largeSpendWei = 0.1 ether;
        }
    }

    /// @dev One-time config for vault parameters (called by factory).
    function initVaultConfig(address unlockInbox_, address philTestMint_, address proofVerifier_) external {
        require(unlockInbox == address(0), "Vault config already set");
        require(unlockInbox_ != address(0), "Invalid inbox");
        require(philTestMint_ != address(0), "Invalid mint");
        if (proofVerifier_ == address(0)) revert InvalidProofVerifier();
        unlockInbox = unlockInbox_;
        philTestMint = philTestMint_;
        proofVerifier = proofVerifier_;
        emit UnlockInboxUpdated(unlockInbox_);
        emit ProofVerifierUpdated(proofVerifier_);
    }

    // ─────────────────────────────────────────────────────────────
    // Owner Management
    // ─────────────────────────────────────────────────────────────

    modifier onlyVaultOwner() {
        if (!isOwner[msg.sender]) revert Unauthorized();
        _;
    }

    function addOwner(address newOwner) external onlyVaultOwner {
        _requireUnlockForSelf(S_OWNER_CHANGE);
        _addOwner(newOwner);
    }

    function removeOwner(address ownerToRemove) external onlyVaultOwner {
        _requireUnlockForSelf(S_OWNER_CHANGE);
        if (!isOwner[ownerToRemove]) revert OwnerNotFound();
        if (ownerCount <= 1) revert MinOwnersRequired();
        isOwner[ownerToRemove] = false;
        ownerCount -= 1;
        emit OwnerRemoved(ownerToRemove);
    }

    function _addOwner(address newOwner) internal {
        if (newOwner == address(0)) revert NewOwnerIsZeroAddress();
        if (isOwner[newOwner]) revert OwnerAlreadyExists();
        isOwner[newOwner] = true;
        ownerCount += 1;
        emit OwnerAdded(newOwner);
    }

    // ─────────────────────────────────────────────────────────────
    // STARK Unlock Config
    // ─────────────────────────────────────────────────────────────

    function setStarkScopeMask(uint32 mask) external onlyVaultOwner {
        _requireUnlockForSelf(S_OWNER_CHANGE);
        starkScopeMask = mask;
        emit StarkScopeMaskUpdated(mask);
    }

    function setLargeSpendWei(uint256 amountWei) external onlyVaultOwner {
        _requireUnlockForSelf(S_OWNER_CHANGE);
        largeSpendWei = amountWei;
        emit LargeSpendUpdated(amountWei);
    }

    function setUnlockInbox(address inbox) external onlyVaultOwner {
        _requireUnlockForSelf(S_OWNER_CHANGE);
        require(inbox != address(0), "Invalid inbox");
        unlockInbox = inbox;
        emit UnlockInboxUpdated(inbox);
    }

    function setProofVerifier(address verifier) external onlyVaultOwner {
        _requireUnlockForSelf(S_OWNER_CHANGE);
        if (verifier == address(0)) revert InvalidProofVerifier();
        proofVerifier = verifier;
        emit ProofVerifierUpdated(verifier);
    }

    // ─────────────────────────────────────────────────────────────
    // Proof-as-2FA
    // ─────────────────────────────────────────────────────────────

    function submitExecutionProof(
        address recipient,
        address target,
        uint256 value,
        bytes calldata data,
        IProofGate.MintProof calldata proof
    ) external onlyVaultOwner {
        if (proofVerifier == address(0)) revert InvalidProofVerifier();
        bytes32 actionHash = computeExecuteActionHash(recipient, target, value, data);
        IPhilAccountProofVerifier(proofVerifier).consumeExecutionProof(recipient, actionHash, proof);
        approvedActionHash[actionHash] = true;
        emit ExecutionProofSubmitted(recipient, actionHash, proof.factHash);
    }

    function submitExecutionBatchProof(
        address recipient,
        Call[] calldata calls,
        IProofGate.MintProof calldata proof
    ) external onlyVaultOwner {
        if (proofVerifier == address(0)) revert InvalidProofVerifier();
        bytes32 actionHash = computeExecuteBatchActionHash(recipient, calls);
        IPhilAccountProofVerifier(proofVerifier).consumeExecutionProof(recipient, actionHash, proof);
        approvedActionHash[actionHash] = true;
        emit ExecutionProofSubmitted(recipient, actionHash, proof.factHash);
    }

    // ─────────────────────────────────────────────────────────────
    // ERC-4337 Validation
    // ─────────────────────────────────────────────────────────────

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        bytes32 ethSignedHash = ECDSA.toEthSignedMessageHash(userOpHash);
        address recovered = ECDSA.recoverCalldata(ethSignedHash, userOp.signature);
        if (!isOwner[recovered]) return 1;

        _enforceUserOpPolicy(userOp);
        return 0;
    }

    /// @dev Keep canonical v0.7 EntryPoint on public networks, but use a fixed
    /// local EntryPoint address on hardhat chain (31337) for local AA testing.
    function entryPoint() public view virtual override returns (address) {
        if (block.chainid == 31337) {
            return LOCAL_ENTRY_POINT_V07;
        }
        return super.entryPoint();
    }

    // ─────────────────────────────────────────────────────────────
    // Execution Guards
    // ─────────────────────────────────────────────────────────────

    function execute(address target, uint256 value, bytes calldata data)
        public
        payable
        virtual
        override
        returns (bytes memory result)
    {
        bytes32 actionHash = computeExecuteActionHash(msg.sender, target, value, data);
        if (!approvedActionHash[actionHash]) revert ProofRequired();
        delete approvedActionHash[actionHash];
        emit ExecutionProofConsumed(msg.sender, actionHash);

        _enforcePolicy(target, value, data, _getTicket());
        return super.execute(target, value, data);
    }

    function executeBatch(Call[] calldata calls)
        public
        payable
        virtual
        override
        returns (bytes[] memory results)
    {
        bytes32 actionHash = computeExecuteBatchActionHash(msg.sender, calls);
        if (!approvedActionHash[actionHash]) revert ProofRequired();
        delete approvedActionHash[actionHash];
        emit ExecutionProofConsumed(msg.sender, actionHash);

        IPhilUnlockInbox.Ticket memory ticket = _getTicket();
        for (uint256 i = 0; i < calls.length; i++) {
            _enforcePolicy(calls[i].target, calls[i].value, calls[i].data, ticket);
        }
        return super.executeBatch(calls);
    }

    // ─────────────────────────────────────────────────────────────
    // Internal Policy Logic
    // ─────────────────────────────────────────────────────────────

    function _enforceUserOpPolicy(PackedUserOperation calldata userOp) internal view {
        if (userOp.callData.length < 4) revert BadCallData();
        bytes4 selector = bytes4(userOp.callData[0:4]);

        IPhilUnlockInbox.Ticket memory ticket = _getTicket();

        if (selector == bytes4(keccak256("execute(address,uint256,bytes)"))) {
            (address target, uint256 value, bytes memory data) = abi.decode(
                userOp.callData[4:], (address, uint256, bytes)
            );
            _enforcePolicy(target, value, data, ticket);
            return;
        }

        if (selector == bytes4(keccak256("executeBatch((address,uint256,bytes)[])"))) {
            Call[] memory calls = abi.decode(userOp.callData[4:], (Call[]));
            for (uint256 i = 0; i < calls.length; i++) {
                _enforcePolicy(calls[i].target, calls[i].value, calls[i].data, ticket);
            }
            return;
        }

        revert BadCallData();
    }

    function _enforcePolicy(
        address target,
        uint256 value,
        bytes memory data,
        IPhilUnlockInbox.Ticket memory ticket
    ) internal view {
        uint32 scope = _scopeForCall(target, value, data);
        if (scope == 0) return;

        if (_requiresTwoOwners(scope) && ownerCount < MIN_OWNERS_FOR_TRADING) {
            revert MinOwnersRequired();
        }

        if ((starkScopeMask & scope) != 0) {
            _requireUnlock(scope, _constraintsHash(target, value, data), ticket);
        }
    }

    function _requiresTwoOwners(uint32 scope) internal pure returns (bool) {
        uint32 tradingMask = S_TRANSFER_PHIL | S_LIST_PHIL | S_ACCEPT_BID | S_SET_APPROVAL_FOR_ALL | S_LARGE_SPEND | S_UPGRADE_WALLET;
        return (scope & tradingMask) != 0;
    }

    function _requireUnlock(
        uint32 requiredScope,
        bytes32 constraintsHash,
        IPhilUnlockInbox.Ticket memory ticket
    ) internal view {
        if (unlockInbox == address(0)) revert UnlockRequired();
        if ((ticket.scope & requiredScope) != requiredScope) revert InvalidUnlockTicket();

        uint256 nowTs = block.timestamp;
        if (ticket.validAfter != 0 && nowTs < ticket.validAfter) revert InvalidUnlockTicket();
        if (ticket.validUntil != 0 && nowTs > ticket.validUntil) revert InvalidUnlockTicket();

        if (ticket.constraintsHash != bytes32(0) && ticket.constraintsHash != constraintsHash) {
            revert InvalidUnlockTicket();
        }
    }

    function computeExecuteActionHash(
        address recipient,
        address target,
        uint256 value,
        bytes calldata data
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(this),
                recipient,
                target,
                value,
                keccak256(data)
            )
        );
    }

    function computeExecuteBatchActionHash(
        address recipient,
        Call[] calldata calls
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(this),
                recipient,
                keccak256(abi.encode(calls))
            )
        );
    }

    function _constraintsHash(
        address target,
        uint256 value,
        bytes memory data
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data));
    }

    function _scopeForCall(
        address target,
        uint256 value,
        bytes memory data
    ) internal view returns (uint32) {
        if (data.length < 4) return 0;
        bytes4 selector;
        assembly {
            selector := mload(add(data, 0x20))
        }

        // Self-management
        if (target == address(this)) {
            if (selector == bytes4(keccak256("addOwner(address)")) ||
                selector == bytes4(keccak256("removeOwner(address)")) ||
                selector == bytes4(keccak256("setStarkScopeMask(uint32)")) ||
                selector == bytes4(keccak256("setLargeSpendWei(uint256)")) ||
                selector == bytes4(keccak256("setUnlockInbox(address)")) ||
                selector == bytes4(keccak256("setProofVerifier(address)"))
            ) {
                return S_OWNER_CHANGE;
            }
            if (selector == bytes4(keccak256("upgradeTo(address)")) ||
                selector == bytes4(keccak256("upgradeToAndCall(address,bytes)"))
            ) {
                return S_UPGRADE_WALLET;
            }
        }

        // ERC721 transfers / approvals
        if (
            selector == 0x23b872dd || // transferFrom(address,address,uint256)
            selector == 0x42842e0e || // safeTransferFrom(address,address,uint256)
            selector == 0xb88d4fde || // safeTransferFrom(address,address,uint256,bytes)
            selector == 0x095ea7b3 || // approve(address,uint256)
            selector == 0xa22cb465    // setApprovalForAll(address,bool)
        ) {
            if (selector == 0x095ea7b3 || selector == 0xa22cb465) {
                return S_SET_APPROVAL_FOR_ALL;
            }
            return S_TRANSFER_PHIL;
        }

        // Phil marketplace actions
        if (target == philTestMint) {
            if (
                selector == bytes4(keccak256("offerForSale(uint256,uint256)")) ||
                selector == bytes4(keccak256("offerForSaleToAddress(uint256,uint256,address)")) ||
                selector == bytes4(keccak256("cancelOffer(uint256)"))
            ) {
                return S_LIST_PHIL;
            }
            if (selector == bytes4(keccak256("acceptBid(uint256,uint256)"))) {
                return S_ACCEPT_BID;
            }
            if (
                selector == bytes4(keccak256("buy(uint256)")) ||
                selector == bytes4(keccak256("enterBid(uint256)"))
            ) {
                return S_LARGE_SPEND;
            }
        }

        // ERC20 approvals/transfers and ETH value spend
        if (
            selector == 0x095ea7b3 || // approve(address,uint256)
            selector == 0xa9059cbb || // transfer(address,uint256)
            selector == 0x23b872dd    // transferFrom(address,address,uint256)
        ) {
            return S_LARGE_SPEND;
        }

        if (largeSpendWei > 0 && value >= largeSpendWei) {
            return S_LARGE_SPEND;
        }

        return 0;
    }

    function _getTicket() internal view returns (IPhilUnlockInbox.Ticket memory) {
        if (unlockInbox == address(0)) {
            return IPhilUnlockInbox.Ticket(0, 0, 0, 0, bytes32(0));
        }
        return IPhilUnlockInbox(unlockInbox).getTicket(address(this));
    }

    function _requireUnlockForSelf(uint32 scope) internal view {
        if ((starkScopeMask & scope) == 0) return;
        IPhilUnlockInbox.Ticket memory ticket = _getTicket();
        _requireUnlock(scope, _constraintsHash(address(this), 0, msg.data), ticket);
    }

    // ─────────────────────────────────────────────────────────────
    // Overrides
    // ─────────────────────────────────────────────────────────────

    function _guardInitializeOwner()
        internal
        pure
        override
        returns (bool)
    {
        return true;
    }

    function _domainNameAndVersion()
        internal
        pure
        override
        returns (string memory name, string memory version)
    {
        name = "PhilAccount";
        version = "2";
    }

    function _authorizeUpgrade(address) internal view override {
        _requireUnlockForSelf(S_UPGRADE_WALLET);
        _checkOwner();
    }

    function _checkOwner() internal view override {
        if (!isOwner[msg.sender]) revert Unauthorized();
    }
}
