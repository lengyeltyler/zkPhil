// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISharpFactRegistry} from "./ISharpFactRegistry.sol";

/// @notice Local deterministic SHARP fact registry adapter used for testing.
/// @dev Replace with the canonical SHARP fact registry address on production networks.
contract LocalSharpFactRegistry is ISharpFactRegistry {
    address public operator;
    mapping(bytes32 => bool) private _validFacts;

    error NotOperator();
    error InvalidOperator();
    error EmptyFact();

    event FactRegistered(bytes32 indexed fact);
    event OperatorUpdated(address indexed newOperator);

    constructor(address operator_) {
        if (operator_ == address(0)) revert InvalidOperator();
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function setOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert InvalidOperator();
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    function registerFact(bytes32 fact) external onlyOperator {
        if (fact == bytes32(0)) revert EmptyFact();
        _validFacts[fact] = true;
        emit FactRegistered(fact);
    }

    function registerFacts(bytes32[] calldata facts) external onlyOperator {
        for (uint256 i = 0; i < facts.length; i++) {
            bytes32 fact = facts[i];
            if (fact == bytes32(0)) revert EmptyFact();
            _validFacts[fact] = true;
            emit FactRegistered(fact);
        }
    }

    function isValid(bytes32 fact) external view override returns (bool) {
        return _validFacts[fact];
    }
}

