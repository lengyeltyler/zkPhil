// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "solady/src/tokens/ERC721.sol";
import {IProofGate} from "./IProofGate.sol";

interface IPhilRenderer {
    function tokenURI(
        uint256 tokenId,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed
    ) external view returns (string memory);

    function renderSvg(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        external
        view
        returns (string memory);
}

/// @title PhilIdentityMint
/// @notice Deterministic Phil identity issuance gated by local eligibility proofs.
contract PhilIdentityMint is ERC721 {
    IPhilRenderer public immutable renderer;
    IProofGate public immutable gate;

    uint256 public constant MAX_SUPPLY = 13;
    uint256 public totalSupply;

    mapping(uint256 => uint8) public philIdOf;
    mapping(uint256 => uint8) public paletteVariantOf;
    mapping(uint256 => uint8) public mixModeOf;
    mapping(uint256 => uint32) public mixSeedOf;

    address public owner;
    address public royaltyReceiver;

    uint256 public constant ROYALTY_BPS = 369;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    event PhilMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed
    );

    error SoldOut();
    error BadPhilId();
    error BadPaletteVariant();
    error BadMixMode();
    error NotOwner();
    error InvalidRecipient();
    error InvalidMintTo();

    constructor(address renderer_, address gate_, address royaltyReceiver_) {
        renderer = IPhilRenderer(renderer_);
        gate = IProofGate(gate_);
        royaltyReceiver = royaltyReceiver_;
        owner = msg.sender;
    }

    function name() public pure override returns (string memory) {
        return "Phil";
    }

    function symbol() public pure override returns (string memory) {
        return "PHIL";
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    function setRoyaltyReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "zero address");
        royaltyReceiver = newReceiver;
    }

    function mint(
        address recipient,
        address mintTo,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed,
        IProofGate.MintProof calldata proof
    ) external {
        if (recipient == address(0)) revert InvalidRecipient();
        if (mintTo == address(0)) revert InvalidMintTo();
        if (philId >= 6) revert BadPhilId();
        if (paletteVariant >= 9) revert BadPaletteVariant();
        if (mixMode > 2) revert BadMixMode();

        uint256 tokenId = totalSupply;
        if (tokenId >= MAX_SUPPLY) revert SoldOut();

        gate.verifyAndConsume(recipient, mintTo, philId, paletteVariant, mixMode, mixSeed, proof);

        unchecked {
            totalSupply = tokenId + 1;
        }
        philIdOf[tokenId] = philId;
        paletteVariantOf[tokenId] = paletteVariant;
        mixModeOf[tokenId] = mixMode;
        mixSeedOf[tokenId] = mixSeed;
        _mint(mintTo, tokenId);

        emit PhilMinted(tokenId, mintTo, philId, paletteVariant, mixMode, mixSeed);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "not minted");
        return renderer.tokenURI(
            tokenId,
            philIdOf[tokenId],
            paletteVariantOf[tokenId],
            mixModeOf[tokenId],
            mixSeedOf[tokenId]
        );
    }

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        receiver = royaltyReceiver;
        royaltyAmount = (salePrice * ROYALTY_BPS) / BPS_DENOMINATOR;
    }
}
