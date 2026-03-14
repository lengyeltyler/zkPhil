// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ERC721} from "solady/src/tokens/ERC721.sol";
import {Base64} from "solady/src/utils/Base64.sol";
import {LibString} from "solady/src/utils/LibString.sol";

interface IPhilLayerRegistry {
    function layerCount() external view returns (uint256);

    function getLayer(uint16 layerId)
        external
        view
        returns (
            string memory name,
            uint8 stackIndex,
            uint8 minSelections,
            uint8 maxSelections
        );

    function getAsset(uint32 assetId)
        external
        view
        returns (
            uint16 layerId,
            uint256 storageId,
            string memory sublayer,
            string memory fileName
        );

    function getVariant(uint32 variantId)
        external
        view
        returns (
            uint16 layerId,
            string memory label,
            string memory style,
            string memory color
        );

    function getLayerVariantIds(uint16 layerId) external view returns (uint32[] memory);

    function getVariantAssetIds(uint32 variantId) external view returns (uint32[] memory);
}

interface IPhilSVGStorage {
    function readSvgBytes(uint256 svgId) external view returns (bytes memory);
}

contract PhilNFT is ERC721, Ownable {
    uint8 public constant MAX_LAYER_COUNT = 13;
    uint8 public constant MAX_SELECTIONS_PER_LAYER = 3;
    uint8 private constant BODY_LAYER_ID = 5;
    uint8 private constant BODY_BASE_LAYER_ID = 6;
    bytes32 private constant BODY_BASE_LAYER_HASH = keccak256("BodyBase");

    IPhilLayerRegistry public immutable layerRegistry;
    IPhilSVGStorage public immutable svgStorage;

    uint256 public totalSupply;

    mapping(uint256 => uint32[39]) private _tokenVariantSlots;
    mapping(uint256 => uint8[13]) private _tokenSelectionCounts;

    error LayerCountMismatch(uint256 expectedCount, uint256 actualCount);
    error MaxSupplyReached();
    error TokenNotMinted(uint256 tokenId);

    event PhilMinted(uint256 indexed tokenId, address indexed recipient);

    constructor(address layerRegistryAddress, address svgStorageAddress, address initialOwner) {
        layerRegistry = IPhilLayerRegistry(layerRegistryAddress);
        svgStorage = IPhilSVGStorage(svgStorageAddress);
        _initializeOwner(initialOwner);
    }

    function name() public pure override returns (string memory) {
        return "Phil";
    }

    function symbol() public pure override returns (string memory) {
        return "PHIL";
    }

    function mint() external returns (uint256 tokenId) {
        tokenId = _mintPhil(msg.sender);
    }

    function ownerMint(address recipient) external onlyOwner returns (uint256 tokenId) {
        tokenId = _mintPhil(recipient);
    }

    function getTokenSelections(uint256 tokenId)
        external
        view
        returns (uint32[39] memory variantIds, uint8[13] memory selectionCounts)
    {
        _requireMinted(tokenId);
        return (_tokenVariantSlots[tokenId], _tokenSelectionCounts[tokenId]);
    }

    function getLayerSelections(uint256 tokenId, uint8 layerId)
        external
        view
        returns (uint32[] memory variantIds)
    {
        _requireMinted(tokenId);
        uint8 selectionCount = _tokenSelectionCounts[tokenId][layerId];
        variantIds = new uint32[](selectionCount);

        for (uint256 index = 0; index < selectionCount; index++) {
            variantIds[index] = _tokenVariantSlots[tokenId][uint256(layerId) * MAX_SELECTIONS_PER_LAYER + index];
        }
    }

    function renderSVG(uint256 tokenId) public view returns (string memory) {
        _requireMinted(tokenId);

        bytes memory layersMarkup;
        uint256 layerCount = layerRegistry.layerCount();

        for (uint256 reverseIndex = layerCount; reverseIndex > 0; reverseIndex--) {
            uint256 layerId = reverseIndex - 1;
            uint8 selectionCount = _tokenSelectionCounts[tokenId][layerId];

            for (uint256 selectionIndex = 0; selectionIndex < selectionCount; selectionIndex++) {
                uint32 variantId =
                    _tokenVariantSlots[tokenId][layerId * MAX_SELECTIONS_PER_LAYER + selectionIndex];
                uint32[] memory assetIds = layerRegistry.getVariantAssetIds(variantId);

                for (uint256 assetIndex = 0; assetIndex < assetIds.length; assetIndex++) {
                    (, uint256 storageId, , ) = layerRegistry.getAsset(assetIds[assetIndex]);
                    bytes memory rawSvg = svgStorage.readSvgBytes(storageId);
                    layersMarkup = abi.encodePacked(
                        layersMarkup,
                        '<image x="0" y="0" width="420" height="420" href="data:image/svg+xml;base64,',
                        Base64.encode(rawSvg),
                        '"/>'
                    );
                }
            }
        }

        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" ',
                'xmlns:xlink="http://www.w3.org/1999/xlink" ',
                'width="420" height="420" viewBox="0 0 420 420">',
                layersMarkup,
                "</svg>"
            )
        );
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireMinted(tokenId);

        string memory image = string(
            abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(bytes(renderSVG(tokenId))))
        );

        string memory attributes = _buildAttributes(tokenId);
        string memory metadata = string(
            abi.encodePacked(
                '{"name":"Phil #',
                LibString.toString(tokenId),
                '","description":"Sepolia test deployment of Phil using raw on-chain SVG layers from zkPhilLayers.",',
                '"attributes":[',
                attributes,
                '],"image":"',
                image,
                '"}'
            )
        );

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(bytes(metadata))
            )
        );
    }

    function _mintPhil(address recipient) internal returns (uint256 tokenId) {
        uint256 layerCount = layerRegistry.layerCount();
        if (layerCount != MAX_LAYER_COUNT) {
            revert LayerCountMismatch(MAX_LAYER_COUNT, layerCount);
        }

        tokenId = totalSupply + 1;
        totalSupply = tokenId;
        _assignSelections(tokenId, recipient);
        _safeMint(recipient, tokenId);

        emit PhilMinted(tokenId, recipient);
    }

    function _assignSelections(uint256 tokenId, address recipient) internal {
        bytes32 seed = keccak256(
            abi.encodePacked(tokenId, recipient, block.prevrandao, block.timestamp, address(this))
        );

        for (uint256 layerId = 0; layerId < MAX_LAYER_COUNT; layerId++) {
            if (layerId == BODY_BASE_LAYER_ID && _isBodyBaseLayer()) {
                _assignBodyBaseSelection(tokenId, seed);
                continue;
            }

            (, , uint8 minSelections, uint8 maxSelections) = layerRegistry.getLayer(uint16(layerId));
            uint32[] memory layerVariants = layerRegistry.getLayerVariantIds(uint16(layerId));

            if (layerVariants.length == 0 || maxSelections == 0) {
                continue;
            }

            bytes32 layerSeed = keccak256(abi.encodePacked(seed, layerId));
            uint8 selectionCount = minSelections;

            if (maxSelections > minSelections) {
                selectionCount = uint8(
                    minSelections +
                        (uint256(layerSeed) % (uint256(maxSelections) - uint256(minSelections) + 1))
                );
            }

            if (selectionCount > layerVariants.length) {
                selectionCount = uint8(layerVariants.length);
            }

            _tokenSelectionCounts[tokenId][layerId] = selectionCount;

            for (uint8 selectionIndex = 0; selectionIndex < selectionCount; selectionIndex++) {
                uint256 variantCursor =
                    uint256(keccak256(abi.encodePacked(layerSeed, selectionIndex))) % layerVariants.length;
                uint32 variantId = layerVariants[variantCursor];

                while (_isAlreadySelected(tokenId, uint8(layerId), variantId, selectionIndex)) {
                    variantCursor = (variantCursor + 1) % layerVariants.length;
                    variantId = layerVariants[variantCursor];
                }

                _tokenVariantSlots[tokenId][layerId * MAX_SELECTIONS_PER_LAYER + selectionIndex] = variantId;
            }
        }
    }

    function _buildAttributes(uint256 tokenId) internal view returns (string memory attributes) {
        uint256 layerCount = layerRegistry.layerCount();

        for (uint256 layerId = 0; layerId < layerCount; layerId++) {
            (string memory layerName, , , ) = layerRegistry.getLayer(uint16(layerId));
            string memory value = _selectionLabel(tokenId, uint8(layerId));
            string memory attribute = string(
                abi.encodePacked(
                    '{"trait_type":"',
                    layerName,
                    '","value":"',
                    value,
                    '"}'
                )
            );

            if (bytes(attributes).length == 0) {
                attributes = attribute;
            } else {
                attributes = string(abi.encodePacked(attributes, ",", attribute));
            }
        }
    }

    function _selectionLabel(uint256 tokenId, uint8 layerId) internal view returns (string memory value) {
        uint8 selectionCount = _tokenSelectionCounts[tokenId][layerId];
        if (selectionCount == 0) {
            return "None";
        }

        for (uint256 index = 0; index < selectionCount; index++) {
            uint32 variantId = _tokenVariantSlots[tokenId][uint256(layerId) * MAX_SELECTIONS_PER_LAYER + index];
            (, string memory label, , ) = layerRegistry.getVariant(variantId);

            if (index == 0) {
                value = label;
            } else {
                value = string(abi.encodePacked(value, " | ", label));
            }
        }
    }

    function _isAlreadySelected(
        uint256 tokenId,
        uint8 layerId,
        uint32 variantId,
        uint8 limit
    ) internal view returns (bool) {
        uint256 baseIndex = uint256(layerId) * MAX_SELECTIONS_PER_LAYER;

        for (uint256 index = 0; index < limit; index++) {
            if (_tokenVariantSlots[tokenId][baseIndex + index] == variantId) {
                return true;
            }
        }

        return false;
    }

    function _assignBodyBaseSelection(uint256 tokenId, bytes32 seed) internal {
        (uint8 minSelections, uint8 maxSelections) = _getSelectionConfig(BODY_BASE_LAYER_ID);
        uint32[] memory bodyBaseVariants = layerRegistry.getLayerVariantIds(BODY_BASE_LAYER_ID);
        if (bodyBaseVariants.length == 0 || maxSelections == 0) {
            return;
        }

        uint8 bodySelectionCount = _tokenSelectionCounts[tokenId][BODY_LAYER_ID];
        if (bodySelectionCount == 0) {
            return;
        }

        uint32 bodyVariantId = _tokenVariantSlots[tokenId][uint256(BODY_LAYER_ID) * MAX_SELECTIONS_PER_LAYER];
        if (bodyVariantId == 0) {
            return;
        }

        bytes32 layerSeed = keccak256(abi.encodePacked(seed, BODY_BASE_LAYER_ID));
        uint8 selectionCount = minSelections;
        if (maxSelections > minSelections) {
            selectionCount = uint8(
                minSelections
                    + (uint256(layerSeed) % (uint256(maxSelections) - uint256(minSelections) + 1))
            );
        }

        if (selectionCount == 0) {
            return;
        }

        uint256 variantCursor =
            uint256(keccak256(abi.encodePacked(layerSeed, uint256(0)))) % bodyBaseVariants.length;
        uint32 variantId = bodyBaseVariants[variantCursor];
        (, , , string memory bodyColor) = layerRegistry.getVariant(bodyVariantId);
        (, , , string memory bodyBaseColor) = layerRegistry.getVariant(variantId);

        if (keccak256(bytes(bodyBaseColor)) == keccak256(bytes(bodyColor))) {
            uint256 sameColorSeed = uint256(keccak256(abi.encodePacked(seed, "bodybase-same-color")));
            if (sameColorSeed % 16 != 0) {
                uint32 alternativeVariantId =
                    _findAlternativeColorVariant(BODY_BASE_LAYER_ID, bodyColor, sameColorSeed);
                if (alternativeVariantId != 0) {
                    variantId = alternativeVariantId;
                }
            }
        }

        _tokenSelectionCounts[tokenId][BODY_BASE_LAYER_ID] = selectionCount;
        _tokenVariantSlots[tokenId][uint256(BODY_BASE_LAYER_ID) * MAX_SELECTIONS_PER_LAYER] = variantId;
    }

    function _findAlternativeColorVariant(uint8 layerId, string memory excludedColor, uint256 seed)
        internal
        view
        returns (uint32)
    {
        uint32[] memory variantIds = layerRegistry.getLayerVariantIds(layerId);
        if (variantIds.length == 0) {
            return 0;
        }

        bytes32 excludedHash = keccak256(bytes(excludedColor));
        uint256 startIndex = seed % variantIds.length;

        for (uint256 offset = 0; offset < variantIds.length; offset++) {
            uint32 variantId = variantIds[(startIndex + offset) % variantIds.length];
            (, , , string memory variantColor) = layerRegistry.getVariant(variantId);

            if (keccak256(bytes(variantColor)) != excludedHash) {
                return variantId;
            }
        }

        return 0;
    }

    function _isBodyBaseLayer() internal view returns (bool) {
        (string memory layerName, , , ) = layerRegistry.getLayer(BODY_BASE_LAYER_ID);
        return keccak256(bytes(layerName)) == BODY_BASE_LAYER_HASH;
    }

    function _getSelectionConfig(uint8 layerId)
        internal
        view
        returns (uint8 minSelections, uint8 maxSelections)
    {
        (, , minSelections, maxSelections) = layerRegistry.getLayer(layerId);
    }

    function _requireMinted(uint256 tokenId) internal view {
        if (_ownerOf(tokenId) == address(0)) {
            revert TokenNotMinted(tokenId);
        }
    }
}
