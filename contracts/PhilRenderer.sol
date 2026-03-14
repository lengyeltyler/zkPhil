// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

/// @notice Compatibility renderer for the legacy Phil stack.
/// @dev Preserves the old renderer interface while sourcing art from zkPhilLayers via
/// `PhilLayerRegistry` + `PhilSVGStorage`.
contract PhilRenderer {
    using LibString for uint256;

    uint8 private constant PHIL_COUNT = 6;
    uint8 private constant PALETTE_COUNT = 9;
    uint8 private constant MIX_MODE_NONE = 0;
    uint8 private constant MIX_MODE_SWAP = 1;
    uint8 private constant MIX_MODE_PERMUTE = 2;
    uint8 private constant MAX_LAYER_COUNT = 13;
    uint8 private constant MAX_SELECTIONS_PER_LAYER = 3;
    uint16 private constant BODY_LAYER_ID = 5;
    uint16 private constant BODY_BASE_LAYER_ID = 6;
    bytes32 private constant BODY_BASE_LAYER_HASH = keccak256("BodyBase");

    IPhilLayerRegistry public immutable layerRegistry;
    IPhilSVGStorage public immutable svgStorage;

    address public owner;
    address public gateway;
    bool public compactTokenURI;

    error BadPhilId();
    error BadMixMode();
    error BadPaletteVariant();
    error CompactTokenURIDisabled();
    error LayerCountMismatch(uint256 expectedCount, uint256 actualCount);
    error NotOwner();

    constructor(address layerRegistry_, address svgStorage_, address gateway_) {
        require(layerRegistry_ != address(0), "layerRegistry=0");
        require(svgStorage_ != address(0), "svgStorage=0");
        layerRegistry = IPhilLayerRegistry(layerRegistry_);
        svgStorage = IPhilSVGStorage(svgStorage_);
        gateway = gateway_;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        owner = newOwner;
    }

    function setGateway(address newGateway) external onlyOwner {
        gateway = newGateway;
    }

    function setCompactTokenURI(bool enabled) external onlyOwner {
        if (enabled) revert CompactTokenURIDisabled();
        compactTokenURI = enabled;
    }

    function renderSvg(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        public
        view
        returns (string memory)
    {
        _validateInputs(philId, paletteVariant, mixMode);

        uint256 layerCount = layerRegistry.layerCount();
        if (layerCount != MAX_LAYER_COUNT) {
            revert LayerCountMismatch(MAX_LAYER_COUNT, layerCount);
        }

        bytes32 seed = _baseSeed(philId, paletteVariant, mixMode, mixSeed);
        bytes memory layersMarkup;

        for (uint256 reverseIndex = layerCount; reverseIndex > 0; reverseIndex--) {
            uint16 layerId = uint16(reverseIndex - 1);
            (uint32[3] memory selectedVariantIds, uint8 selectionCount) =
                _selectLayerVariants(seed, layerId);

            for (uint256 selectionIndex = 0; selectionIndex < selectionCount; selectionIndex++) {
                uint32[] memory assetIds = layerRegistry.getVariantAssetIds(selectedVariantIds[selectionIndex]);

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

    function tokenURI(
        uint256 tokenId,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed
    ) external view returns (string memory) {
        _validateInputs(philId, paletteVariant, mixMode);

        string memory svg = renderSvg(philId, paletteVariant, mixMode, mixSeed);
        string memory image = string(
            abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(bytes(svg)))
        );

        string memory metadata = string(
            abi.encodePacked(
                '{"name":"Phil #',
                tokenId.toString(),
                '","description":"Phil legacy renderer backed by zkPhilLayers on-chain storage.",',
                '"attributes":[',
                _buildAttributes(philId, paletteVariant, mixMode, mixSeed),
                '],"image":"',
                image,
                '"}'
            )
        );

        return string(
            abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(metadata)))
        );
    }

    function renderHash(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        external
        view
        returns (bytes32)
    {
        return keccak256(bytes(renderSvg(philId, paletteVariant, mixMode, mixSeed)));
    }

    function _buildAttributes(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        internal
        view
        returns (string memory attributes)
    {
        attributes = string(
            abi.encodePacked(
                '{"trait_type":"Phil ID","value":"',
                uint256(philId).toString(),
                '"},{"trait_type":"Palette","value":"',
                uint256(paletteVariant).toString(),
                '"},{"trait_type":"Mix Mode","value":"',
                uint256(mixMode).toString(),
                '"},{"trait_type":"Mix Seed","value":"',
                uint256(mixSeed).toString(),
                '"}'
            )
        );

        bytes32 seed = _baseSeed(philId, paletteVariant, mixMode, mixSeed);
        uint256 layerCount = layerRegistry.layerCount();

        for (uint16 layerId = 0; layerId < layerCount; layerId++) {
            (string memory layerName, , , ) = layerRegistry.getLayer(layerId);
            string memory value = _selectionLabel(seed, layerId);
            attributes = string(
                abi.encodePacked(
                    attributes,
                    ',{"trait_type":"',
                    layerName,
                    '","value":"',
                    value,
                    '"}'
                )
            );
        }
    }

    function _selectionLabel(bytes32 seed, uint16 layerId) internal view returns (string memory value) {
        (uint32[3] memory selectedVariantIds, uint8 selectionCount) = _selectLayerVariants(seed, layerId);
        if (selectionCount == 0) {
            return "None";
        }

        for (uint256 index = 0; index < selectionCount; index++) {
            (, string memory label, , ) = layerRegistry.getVariant(selectedVariantIds[index]);
            if (index == 0) {
                value = label;
            } else {
                value = string(abi.encodePacked(value, " | ", label));
            }
        }
    }

    function _selectLayerVariants(bytes32 seed, uint16 layerId)
        internal
        view
        returns (uint32[3] memory selectedVariantIds, uint8 selectionCount)
    {
        if (layerId == BODY_BASE_LAYER_ID && _isBodyBaseLayer()) {
            return _selectBodyBaseVariants(seed);
        }

        return _selectLayerVariantsRaw(seed, layerId);
    }

    function _selectLayerVariantsRaw(bytes32 seed, uint16 layerId)
        internal
        view
        returns (uint32[3] memory selectedVariantIds, uint8 selectionCount)
    {
        (, , uint8 minSelections, uint8 maxSelections) = layerRegistry.getLayer(layerId);
        uint32[] memory layerVariants = layerRegistry.getLayerVariantIds(layerId);

        if (layerVariants.length == 0 || maxSelections == 0) {
            return (selectedVariantIds, 0);
        }

        bytes32 layerSeed = keccak256(abi.encodePacked(seed, layerId));
        selectionCount = minSelections;

        if (maxSelections > minSelections) {
            selectionCount = uint8(
                minSelections
                    + (uint256(layerSeed) % (uint256(maxSelections) - uint256(minSelections) + 1))
            );
        }

        if (selectionCount > layerVariants.length) {
            selectionCount = uint8(layerVariants.length);
        }

        for (uint8 selectionIndex = 0; selectionIndex < selectionCount; selectionIndex++) {
            uint256 variantCursor =
                uint256(keccak256(abi.encodePacked(layerSeed, selectionIndex))) % layerVariants.length;
            uint32 variantId = layerVariants[variantCursor];

            while (_alreadySelected(selectedVariantIds, selectionIndex, variantId)) {
                variantCursor = (variantCursor + 1) % layerVariants.length;
                variantId = layerVariants[variantCursor];
            }

            selectedVariantIds[selectionIndex] = variantId;
        }
    }

    function _selectBodyBaseVariants(bytes32 seed)
        internal
        view
        returns (uint32[3] memory selectedVariantIds, uint8 selectionCount)
    {
        (selectedVariantIds, selectionCount) = _selectLayerVariantsRaw(seed, BODY_BASE_LAYER_ID);
        if (selectionCount == 0) {
            return (selectedVariantIds, 0);
        }

        (uint32[3] memory bodyVariantIds, uint8 bodySelectionCount) =
            _selectLayerVariantsRaw(seed, BODY_LAYER_ID);
        if (bodySelectionCount == 0) {
            return (selectedVariantIds, selectionCount);
        }

        (, , , string memory bodyColor) = layerRegistry.getVariant(bodyVariantIds[0]);
        (, , , string memory bodyBaseColor) = layerRegistry.getVariant(selectedVariantIds[0]);
        if (keccak256(bytes(bodyBaseColor)) != keccak256(bytes(bodyColor))) {
            return (selectedVariantIds, selectionCount);
        }

        uint256 sameColorSeed = uint256(keccak256(abi.encodePacked(seed, "bodybase-same-color")));
        if (sameColorSeed % 16 == 0) {
            return (selectedVariantIds, selectionCount);
        }

        uint32 alternativeVariantId =
            _findAlternativeColorVariant(BODY_BASE_LAYER_ID, bodyColor, sameColorSeed);
        if (alternativeVariantId != 0) {
            selectedVariantIds[0] = alternativeVariantId;
        }

        return (selectedVariantIds, selectionCount);
    }

    function _findAlternativeColorVariant(uint16 layerId, string memory excludedColor, uint256 seed)
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

    function _alreadySelected(uint32[3] memory selectedVariantIds, uint8 limit, uint32 variantId)
        internal
        pure
        returns (bool)
    {
        for (uint256 index = 0; index < limit; index++) {
            if (selectedVariantIds[index] == variantId) {
                return true;
            }
        }
        return false;
    }

    function _baseSeed(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        internal
        pure
        returns (bytes32)
    {
        if (mixMode == MIX_MODE_NONE) {
            return keccak256(abi.encodePacked("zkPhil", philId, paletteVariant));
        }

        if (mixMode == MIX_MODE_SWAP) {
            return keccak256(abi.encodePacked("zkPhil-swap", philId, paletteVariant, mixSeed));
        }

        return keccak256(abi.encodePacked("zkPhil-permute", mixSeed, paletteVariant, philId));
    }

    function _validateInputs(uint8 philId, uint8 paletteVariant, uint8 mixMode) internal pure {
        if (philId >= PHIL_COUNT) revert BadPhilId();
        if (paletteVariant >= PALETTE_COUNT) revert BadPaletteVariant();
        if (mixMode > MIX_MODE_PERMUTE) revert BadMixMode();
    }
}
