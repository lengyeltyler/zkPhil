// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockRenderer {
    function tokenURI(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    ) external pure returns (string memory) {
        return "data:application/json;utf8,{\"name\":\"Mock\",\"image\":\"data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Crect%20width='100'%20height='100'%20fill='%23000'/%3E%3Ccircle%20cx='50'%20cy='50'%20r='30'%20fill='%23fff'/%3E%3C/svg%3E\"}";
    }

    function renderSvg(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    ) external pure returns (string memory) {
        return "<svg xmlns='http://www.w3.org/2000/svg'></svg>";
    }
}
