// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarketplaceBuy {
    function buy(uint256 tokenId) external payable;
}

/// @notice Test harness that attempts a nested marketplace buy in the ERC721 receiver hook.
contract MarketplaceReentrantBuyer {
    IMarketplaceBuy public immutable marketplace;

    uint256 public reentryTokenId;
    uint256 public reentryValue;
    bool public attemptedReentry;
    bool public reentrySucceeded;

    constructor(address marketplace_) {
        marketplace = IMarketplaceBuy(marketplace_);
    }

    function configureReentry(uint256 tokenId, uint256 value) external {
        reentryTokenId = tokenId;
        reentryValue = value;
    }

    function attackBuy(uint256 tokenId) external payable {
        marketplace.buy{value: msg.value}(tokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!attemptedReentry && reentryValue != 0) {
            attemptedReentry = true;
            (bool success,) = address(marketplace).call{value: reentryValue}(
                abi.encodeWithSignature("buy(uint256)", reentryTokenId)
            );
            reentrySucceeded = success;
        }

        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
