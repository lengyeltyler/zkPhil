// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SSTORE2} from "solady/src/utils/SSTORE2.sol";

contract SSTORE2Deployer {
    function write(bytes calldata data) external returns (address pointer) {
        pointer = SSTORE2.write(data);
    }

    function read(address pointer) external view returns (bytes memory) {
        return SSTORE2.read(pointer);
    }
}