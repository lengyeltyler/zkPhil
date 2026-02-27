// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockAccountOwner {
    mapping(address => bool) public isOwner;

    constructor(address owner_) {
        isOwner[owner_] = true;
    }

    function setOwner(address owner_, bool allowed) external {
        isOwner[owner_] = allowed;
    }

    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory result) {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        require(ok, "exec failed");
        return ret;
    }
}
