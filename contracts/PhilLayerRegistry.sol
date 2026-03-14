// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/src/auth/Ownable.sol";

contract PhilLayerRegistry is Ownable {
    struct Layer {
        string name;
        uint8 stackIndex;
        uint8 minSelections;
        uint8 maxSelections;
    }

    struct Asset {
        uint16 layerId;
        uint256 storageId;
        string sublayer;
        string fileName;
    }

    struct Variant {
        uint16 layerId;
        string label;
        string style;
        string color;
    }

    struct LayerInput {
        string name;
        uint8 minSelections;
        uint8 maxSelections;
    }

    struct AssetInput {
        uint16 layerId;
        uint256 storageId;
        string sublayer;
        string fileName;
    }

    struct VariantInput {
        uint16 layerId;
        string label;
        string style;
        string color;
        uint32[] assetIds;
    }

    address public immutable svgStorage;
    uint32 public nextAssetId = 1;
    uint32 public nextVariantId = 1;

    Layer[] private _layers;
    mapping(uint32 => Asset) private _assets;
    mapping(uint32 => Variant) private _variants;
    mapping(uint16 => uint32[]) private _layerAssetIds;
    mapping(uint16 => uint32[]) private _layerVariantIds;
    mapping(uint32 => uint32[]) private _variantAssetIds;

    error AssetLayerMismatch(uint32 assetId, uint16 expectedLayerId, uint16 actualLayerId);
    error EmptyAssetList(uint16 layerId);
    error InvalidLayerId(uint16 layerId);
    error InvalidSelectionRange(uint8 minSelections, uint8 maxSelections);
    error InvalidStorageId();
    error UnknownAssetId(uint32 assetId);
    error UnknownVariantId(uint32 variantId);

    event AssetRegistered(
        uint32 indexed assetId,
        uint16 indexed layerId,
        uint256 indexed storageId,
        string sublayer,
        string fileName
    );
    event LayerRegistered(
        uint16 indexed layerId,
        string name,
        uint8 stackIndex,
        uint8 minSelections,
        uint8 maxSelections
    );
    event VariantRegistered(
        uint32 indexed variantId,
        uint16 indexed layerId,
        string label,
        string style,
        string color
    );

    constructor(address svgStorageAddress, address initialOwner) {
        svgStorage = svgStorageAddress;
        _initializeOwner(initialOwner);
    }

    function layerCount() external view returns (uint256) {
        return _layers.length;
    }

    function registerLayer(
        string calldata name,
        uint8 minSelections,
        uint8 maxSelections
    ) public onlyOwner returns (uint16 layerId) {
        if (minSelections > maxSelections) {
            revert InvalidSelectionRange(minSelections, maxSelections);
        }

        layerId = uint16(_layers.length);
        _layers.push(
            Layer({
                name: name,
                stackIndex: uint8(layerId),
                minSelections: minSelections,
                maxSelections: maxSelections
            })
        );

        emit LayerRegistered(layerId, name, uint8(layerId), minSelections, maxSelections);
    }

    function registerLayers(LayerInput[] calldata inputs) external onlyOwner {
        for (uint256 index = 0; index < inputs.length; index++) {
            registerLayer(inputs[index].name, inputs[index].minSelections, inputs[index].maxSelections);
        }
    }

    function registerAssets(AssetInput[] calldata inputs) external onlyOwner {
        for (uint256 index = 0; index < inputs.length; index++) {
            AssetInput calldata input = inputs[index];
            if (input.layerId >= _layers.length) revert InvalidLayerId(input.layerId);
            if (input.storageId == 0) revert InvalidStorageId();

            uint32 assetId = nextAssetId++;
            _assets[assetId] = Asset({
                layerId: input.layerId,
                storageId: input.storageId,
                sublayer: input.sublayer,
                fileName: input.fileName
            });

            _layerAssetIds[input.layerId].push(assetId);
            emit AssetRegistered(assetId, input.layerId, input.storageId, input.sublayer, input.fileName);
        }
    }

    function registerVariants(VariantInput[] calldata inputs) external onlyOwner {
        for (uint256 index = 0; index < inputs.length; index++) {
            VariantInput calldata input = inputs[index];
            if (input.layerId >= _layers.length) revert InvalidLayerId(input.layerId);
            if (input.assetIds.length == 0) revert EmptyAssetList(input.layerId);

            for (uint256 assetIndex = 0; assetIndex < input.assetIds.length; assetIndex++) {
                uint32 assetId = input.assetIds[assetIndex];
                Asset storage asset = _assets[assetId];
                if (asset.storageId == 0) revert UnknownAssetId(assetId);
                if (asset.layerId != input.layerId) {
                    revert AssetLayerMismatch(assetId, input.layerId, asset.layerId);
                }
            }

            uint32 variantId = nextVariantId++;
            _variants[variantId] = Variant({
                layerId: input.layerId,
                label: input.label,
                style: input.style,
                color: input.color
            });

            for (uint256 assetIndex = 0; assetIndex < input.assetIds.length; assetIndex++) {
                _variantAssetIds[variantId].push(input.assetIds[assetIndex]);
            }

            _layerVariantIds[input.layerId].push(variantId);
            emit VariantRegistered(variantId, input.layerId, input.label, input.style, input.color);
        }
    }

    function getLayer(uint16 layerId)
        external
        view
        returns (
            string memory name,
            uint8 stackIndex,
            uint8 minSelections,
            uint8 maxSelections
        )
    {
        if (layerId >= _layers.length) revert InvalidLayerId(layerId);
        Layer storage layer = _layers[layerId];
        return (layer.name, layer.stackIndex, layer.minSelections, layer.maxSelections);
    }

    function getAsset(uint32 assetId)
        external
        view
        returns (
            uint16 layerId,
            uint256 storageId,
            string memory sublayer,
            string memory fileName
        )
    {
        Asset storage asset = _assets[assetId];
        if (asset.storageId == 0) revert UnknownAssetId(assetId);
        return (asset.layerId, asset.storageId, asset.sublayer, asset.fileName);
    }

    function getVariant(uint32 variantId)
        external
        view
        returns (
            uint16 layerId,
            string memory label,
            string memory style,
            string memory color
        )
    {
        Variant storage variant = _variants[variantId];
        if (bytes(variant.label).length == 0) revert UnknownVariantId(variantId);
        return (variant.layerId, variant.label, variant.style, variant.color);
    }

    function getLayerAssetIds(uint16 layerId) external view returns (uint32[] memory) {
        if (layerId >= _layers.length) revert InvalidLayerId(layerId);
        return _layerAssetIds[layerId];
    }

    function getLayerVariantIds(uint16 layerId) external view returns (uint32[] memory) {
        if (layerId >= _layers.length) revert InvalidLayerId(layerId);
        return _layerVariantIds[layerId];
    }

    function getVariantAssetIds(uint32 variantId) external view returns (uint32[] memory) {
        Variant storage variant = _variants[variantId];
        if (bytes(variant.label).length == 0) revert UnknownVariantId(variantId);
        return _variantAssetIds[variantId];
    }
}
