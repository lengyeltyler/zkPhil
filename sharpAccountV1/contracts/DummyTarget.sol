// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DummyTarget {
    uint256 public number;
    uint256 public calls;
    address public lastCaller;
    uint256 public lastValue;
    bytes public lastData;

    event NumberSet(uint256 indexed number, uint256 indexed value, address indexed caller);

    function setNumber(uint256 value_) external payable {
        number = value_;
        calls += 1;
        lastCaller = msg.sender;
        lastValue = msg.value;
        lastData = msg.data;
        emit NumberSet(value_, msg.value, msg.sender);
    }
}

