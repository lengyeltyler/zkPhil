// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC4804 {
    /// @notice Returns (mimeType, content)
    function read(string calldata path) external view returns (string memory, bytes memory);
}