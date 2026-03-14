// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAtlanticSatellite} from "./IAtlanticSatellite.sol";

/// @title MockSatellite
/// @notice DEPRECATED — Mock for the Atlantic Satellite interface.
/// @dev This contract is NOT used by ProofGateTest13 or any active Phil contract.
///      For local proof testing, use DevProofVerifier (contracts/proofs/DevProofVerifier.sol)
///      which implements ISharpFactRegistry (the SHARP interface used in production).
///      This file is retained for reference only.
contract MockSatellite is IAtlanticSatellite {
    /// @notice Whether to accept all facts (for testing)
    bool public acceptAll;

    /// @notice Manually registered valid facts
    mapping(bytes32 => bool) public registeredFacts;

    /// @notice Contract owner
    address public owner;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event FactRegistered(bytes32 indexed factHash);
    event FactRevoked(bytes32 indexed factHash);
    event AcceptAllChanged(bool acceptAll);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error NotOwner();

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    /// @param acceptAll_ If true, all facts are considered valid
    constructor(bool acceptAll_) {
        acceptAll = acceptAll_;
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    // Admin Functions
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Set whether to accept all facts
    function setAcceptAll(bool acceptAll_) external onlyOwner {
        acceptAll = acceptAll_;
        emit AcceptAllChanged(acceptAll_);
    }

    /// @notice Register a specific fact as valid
    function registerFact(bytes32 factHash) external onlyOwner {
        registeredFacts[factHash] = true;
        emit FactRegistered(factHash);
    }

    /// @notice Revoke a specific fact
    function revokeFact(bytes32 factHash) external onlyOwner {
        registeredFacts[factHash] = false;
        emit FactRevoked(factHash);
    }

    /// @notice Register multiple facts at once
    function registerFactBatch(bytes32[] calldata factHashes) external onlyOwner {
        for (uint256 i = 0; i < factHashes.length; i++) {
            registeredFacts[factHashes[i]] = true;
            emit FactRegistered(factHashes[i]);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // IAtlanticSatellite Implementation
    // ─────────────────────────────────────────────────────────────

    /// @inheritdoc IAtlanticSatellite
    function isValid(bytes32 factHash) external view override returns (bool) {
        if (acceptAll) {
            return true;
        }
        return registeredFacts[factHash];
    }
}
