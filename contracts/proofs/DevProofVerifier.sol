// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISharpFactRegistry} from "./ISharpFactRegistry.sol";

/// @title DevProofVerifier
/// @notice DEV-ONLY local SHARP fact registry for hardhat/anvil (chainId 31337).
/// @dev Implements ISharpFactRegistry with operator-controlled fact registration.
///      NEVER deploy this to mainnet or any public testnet.
///      This contract reverts if called on a non-local chain.
///
///      On production networks, replace with the real SHARP fact registry address:
///        Mainnet: 0x47312450B3Ac8b5b8e247a6bB6d523e7a9E80E50
///        Sepolia: 0x07ec0D28e50322Eb0C159B9090ecF3aeA8346DFe
///
///      Fact format (must match cairo/src/allowlist.cairo outputs):
///        fact = keccak256(abi.encode(programHash, outputsHash))
///        outputsHash = keccak256(abi.encodePacked(output[0], output[1], ..., output[5]))
///        outputs = [root, drop_id, recipient, nullifier, leaf, idx] (each uint256)
contract DevProofVerifier is ISharpFactRegistry {
    // ─────────────────────────────────────────────────────────────
    // DEV GUARD — prevents accidental production use
    // ─────────────────────────────────────────────────────────────

    uint256 private constant LOCAL_CHAIN_ID = 31337;

    error NotLocalChain(uint256 chainId);
    error NotOperator();
    error InvalidOperator();
    error EmptyFact();

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    address public operator;
    mapping(bytes32 => bool) private _validFacts;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event FactRegistered(bytes32 indexed fact);
    event OperatorUpdated(address indexed newOperator);

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    /// @param operator_ Address authorized to register facts (typically the deployer).
    constructor(address operator_) {
        if (block.chainid != LOCAL_CHAIN_ID) revert NotLocalChain(block.chainid);
        if (operator_ == address(0)) revert InvalidOperator();
        operator = operator_;
    }

    // ─────────────────────────────────────────────────────────────
    // Operator management
    // ─────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function setOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert InvalidOperator();
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    // ─────────────────────────────────────────────────────────────
    // Fact registration (operator only)
    // ─────────────────────────────────────────────────────────────

    /// @notice Register a single fact as valid.
    /// @dev fact = keccak256(abi.encode(programHash, outputsHash))
    function registerFact(bytes32 fact) external onlyOperator {
        if (fact == bytes32(0)) revert EmptyFact();
        _validFacts[fact] = true;
        emit FactRegistered(fact);
    }

    /// @notice Register multiple facts at once (batch for efficiency).
    function registerFacts(bytes32[] calldata facts) external onlyOperator {
        for (uint256 i = 0; i < facts.length; i++) {
            bytes32 fact = facts[i];
            if (fact == bytes32(0)) revert EmptyFact();
            _validFacts[fact] = true;
            emit FactRegistered(fact);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // ISharpFactRegistry
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc ISharpFactRegistry
    function isValid(bytes32 fact) external view override returns (bool) {
        if (block.chainid != LOCAL_CHAIN_ID) revert NotLocalChain(block.chainid);
        return _validFacts[fact];
    }

    // ─────────────────────────────────────────────────────────────
    // Utility: compute expected fact from program hash + outputs
    // ─────────────────────────────────────────────────────────────

    /// @notice Compute the SHARP fact hash from a Cairo program hash and 6 public outputs.
    /// @dev Matches the format expected by the allowlist Cairo program outputs:
    ///      outputs = [root, drop_id, recipient, nullifier, leaf, idx]
    ///      outputsHash = keccak256(abi.encodePacked(outputs))
    ///      fact = keccak256(abi.encode(programHash, outputsHash))
    function computeFact(
        bytes32 programHash,
        uint256[6] calldata outputs
    ) external pure returns (bytes32) {
        bytes32 outputsHash = keccak256(abi.encodePacked(outputs));
        return keccak256(abi.encode(programHash, outputsHash));
    }
}
