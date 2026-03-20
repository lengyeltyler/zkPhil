// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";

interface IPhilMarketplaceToken {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @title PhilMarketplace
/// @notice CryptoPunks-style on-chain marketplace for Phil ERC721 tokens.
contract PhilMarketplace is Ownable, ReentrancyGuard {
    uint96 public constant BPS_DENOMINATOR = 10_000;
    uint96 public constant MAX_ROYALTY_BPS = 1_000;

    struct Offer {
        address seller;
        uint256 minPrice;
        address onlySellTo;
    }

    struct Bid {
        address bidder;
        uint256 amount;
    }

    IPhilMarketplaceToken public immutable philToken;
    address public immutable royaltyRecipient;
    uint96 public immutable royaltyBps;
    bool public paused;

    mapping(uint256 => Offer) public offers;
    mapping(uint256 => Bid) public bids;

    event OfferCreated(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 minPrice,
        address indexed onlySellTo
    );
    event OfferCancelled(uint256 indexed tokenId, address indexed seller);
    event OfferFilled(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 royalty
    );
    event BidEntered(uint256 indexed tokenId, address indexed bidder, uint256 amount);
    event BidWithdrawn(uint256 indexed tokenId, address indexed bidder, uint256 amount);
    event BidAccepted(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed bidder,
        uint256 amount,
        uint256 royalty
    );
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error InvalidTokenAddress();
    error InvalidRoyaltyRecipient();
    error RoyaltyTooHigh();
    error MarketplacePaused();
    error NotTokenOwner();
    error MarketplaceNotApproved();
    error NoActiveOffer();
    error NotAuthorizedBuyer();
    error OfferPriceNotMet();
    error CannotBidOnOwnedToken();
    error BidTooLow();
    error NoActiveBid();
    error NotBidder();
    error BidPriceNotMet();
    error CannotAcceptOwnBid();
    error EthTransferFailed();

    constructor(address philToken_, address royaltyRecipient_, uint96 royaltyBps_) {
        if (philToken_ == address(0)) revert InvalidTokenAddress();
        if (royaltyRecipient_ == address(0)) revert InvalidRoyaltyRecipient();
        if (royaltyBps_ > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _initializeOwner(msg.sender);

        philToken = IPhilMarketplaceToken(philToken_);
        royaltyRecipient = royaltyRecipient_;
        royaltyBps = royaltyBps_;
    }

    modifier whenNotPaused() {
        if (paused) revert MarketplacePaused();
        _;
    }

    function offerForSale(
        uint256 tokenId,
        uint256 minPrice,
        address toAddressOrZeroForPublic
    ) external whenNotPaused {
        address seller = _currentOwner(tokenId);
        if (seller != msg.sender) revert NotTokenOwner();
        _requireMarketplaceApproval(seller, tokenId);

        offers[tokenId] = Offer({
            seller: seller,
            minPrice: minPrice,
            onlySellTo: toAddressOrZeroForPublic
        });

        emit OfferCreated(tokenId, seller, minPrice, toAddressOrZeroForPublic);
    }

    function cancelOffer(uint256 tokenId) external {
        address ownerOfToken = _currentOwner(tokenId);
        if (ownerOfToken != msg.sender) revert NotTokenOwner();

        Offer memory offer = offers[tokenId];
        if (offer.seller == address(0)) revert NoActiveOffer();

        delete offers[tokenId];
        emit OfferCancelled(tokenId, msg.sender);
    }

    function buy(uint256 tokenId) external payable nonReentrant whenNotPaused {
        Offer memory offer = offers[tokenId];
        if (offer.seller == address(0)) revert NoActiveOffer();

        address seller = _currentOwner(tokenId);
        if (seller != offer.seller) revert NoActiveOffer();
        if (offer.onlySellTo != address(0) && offer.onlySellTo != msg.sender) {
            revert NotAuthorizedBuyer();
        }
        if (msg.value < offer.minPrice) revert OfferPriceNotMet();
        _requireMarketplaceApproval(seller, tokenId);

        delete offers[tokenId];

        philToken.safeTransferFrom(seller, msg.sender, tokenId);

        (uint256 sellerProceeds, uint256 royaltyAmount) = _splitSaleProceeds(msg.value);
        if (royaltyAmount != 0) {
            _sendETH(royaltyRecipient, royaltyAmount);
        }
        _sendETH(seller, sellerProceeds);

        emit OfferFilled(tokenId, seller, msg.sender, msg.value, royaltyAmount);
    }

    function enterBid(uint256 tokenId) external payable nonReentrant whenNotPaused {
        address ownerOfToken = _currentOwner(tokenId);
        if (ownerOfToken == msg.sender) revert CannotBidOnOwnedToken();
        if (msg.value == 0) revert BidTooLow();

        Bid memory previous = bids[tokenId];
        if (msg.value <= previous.amount) revert BidTooLow();

        bids[tokenId] = Bid({
            bidder: msg.sender,
            amount: msg.value
        });

        if (previous.amount != 0) {
            _sendETH(previous.bidder, previous.amount);
            emit BidWithdrawn(tokenId, previous.bidder, previous.amount);
        }

        emit BidEntered(tokenId, msg.sender, msg.value);
    }

    function withdrawBid(uint256 tokenId) external nonReentrant {
        Bid memory bid = bids[tokenId];
        if (bid.amount == 0) revert NoActiveBid();
        if (bid.bidder != msg.sender) revert NotBidder();

        delete bids[tokenId];
        _sendETH(msg.sender, bid.amount);

        emit BidWithdrawn(tokenId, msg.sender, bid.amount);
    }

    function acceptBid(uint256 tokenId, uint256 minPrice) external nonReentrant whenNotPaused {
        address seller = _currentOwner(tokenId);
        if (seller != msg.sender) revert NotTokenOwner();
        _requireMarketplaceApproval(seller, tokenId);

        Bid memory bid = bids[tokenId];
        if (bid.amount == 0) revert NoActiveBid();
        if (bid.amount < minPrice) revert BidPriceNotMet();
        if (bid.bidder == seller) revert CannotAcceptOwnBid();

        delete bids[tokenId];
        delete offers[tokenId];

        philToken.safeTransferFrom(seller, bid.bidder, tokenId);

        (uint256 sellerProceeds, uint256 royaltyAmount) = _splitSaleProceeds(bid.amount);
        if (royaltyAmount != 0) {
            _sendETH(royaltyRecipient, royaltyAmount);
        }
        _sendETH(seller, sellerProceeds);

        emit BidAccepted(tokenId, seller, bid.bidder, bid.amount, royaltyAmount);
    }

    function pause() external onlyOwner {
        if (!paused) {
            paused = true;
            emit Paused(msg.sender);
        }
    }

    function unpause() external onlyOwner {
        if (paused) {
            paused = false;
            emit Unpaused(msg.sender);
        }
    }

    function _currentOwner(uint256 tokenId) internal view returns (address) {
        return philToken.ownerOf(tokenId);
    }

    function _requireMarketplaceApproval(address ownerOfToken, uint256 tokenId) internal view {
        if (
            philToken.getApproved(tokenId) != address(this)
                && !philToken.isApprovedForAll(ownerOfToken, address(this))
        ) {
            revert MarketplaceNotApproved();
        }
    }

    function _splitSaleProceeds(uint256 grossAmount)
        internal
        view
        returns (uint256 sellerProceeds, uint256 royaltyAmount)
    {
        royaltyAmount = (grossAmount * royaltyBps) / BPS_DENOMINATOR;
        sellerProceeds = grossAmount - royaltyAmount;
    }

    function _sendETH(address recipient, uint256 amount) internal {
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert EthTransferFailed();
    }
}
