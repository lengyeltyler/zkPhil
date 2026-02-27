// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LocalSmartAccount
/// @notice Minimal owner-controlled smart account for local dev flows.
/// @dev This account is intentionally simple: single owner + execute.
contract LocalSmartAccount {
    address public immutable owner;

    error NotOwner();

    constructor(address owner_) {
        require(owner_ != address(0), "owner=0");
        owner = owner_;
    }

    receive() external payable {}

    function execute(address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        if (msg.sender != owner) revert NotOwner();
        (bool success, bytes memory ret) = target.call{value: value}(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }
}
