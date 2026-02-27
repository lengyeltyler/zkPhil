// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SSTORE2} from "solady/src/utils/SSTORE2.sol";
import {LibString} from "solady/src/utils/LibString.sol";
import {Base64} from "solady/src/utils/Base64.sol";

import {PhilDSLDecoder} from "./PhilDSLDecoder.sol";

interface IPhilFragments {
    function fragmentRange(uint8 philId, uint8 slot)
        external
        view
        returns (uint16 start, uint16 end, bool isDsl);

    function chunkPtr(uint16 chunkIndex) external view returns (address);
}

interface IPhilPalettes {
    function palettePointer(uint8 philId) external view returns (address);

    function slotCount(uint8 philId) external view returns (uint8);
}

/// @notice Fragment route renderer: assembles per-phil fragments + palette mapping + optional DSL decode.
contract PhilRenderer {
    using LibString for uint256;

    uint8 private constant PHIL_COUNT = 6;
    uint8 private constant SLOT_COUNT = 11;
    uint8 private constant PALETTE_COUNT = 9;

    uint8 private constant MIX_MODE_NONE = 0;
    uint8 private constant MIX_MODE_SWAP = 1;
    uint8 private constant MIX_MODE_PERMUTE = 2;
    uint32 private constant GOLDEN_MIX_SEED = 0x9e3779b9;

    IPhilFragments public immutable fragments;
    IPhilPalettes public immutable palettes;

    address public owner;
    address public gateway;
    bool public compactTokenURI = true;

    error BadPhilId();
    error BadPaletteVariant();
    error BadMixMode();
    error NotOwner();
    error InvalidPalettePointer();
    error InvalidPaletteData();

    constructor(address fragments_, address palettes_, address gateway_) {
        require(fragments_ != address(0), "fragments=0");
        require(palettes_ != address(0), "palettes=0");
        fragments = IPhilFragments(fragments_);
        palettes = IPhilPalettes(palettes_);
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
        compactTokenURI = enabled;
    }

    function renderSvg(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        public
        view
        returns (string memory)
    {
        if (philId >= PHIL_COUNT) revert BadPhilId();
        if (paletteVariant >= PALETTE_COUNT) revert BadPaletteVariant();
        if (mixMode > MIX_MODE_PERMUTE) revert BadMixMode();

        uint8 slotCount = palettes.slotCount(philId);
        address palettePointer = palettes.palettePointer(philId);
        if (palettePointer == address(0)) revert InvalidPalettePointer();

        bytes memory paletteData = SSTORE2.read(palettePointer);
        uint256 expectedPaletteBytes = uint256(slotCount) * uint256(PALETTE_COUNT) * 3;
        if (paletteData.length < expectedPaletteBytes) revert InvalidPaletteData();

        uint8[] memory mixedOrder = _buildMixedOrder(slotCount, mixMode, mixSeed);
        bytes[] memory segments = new bytes[](SLOT_COUNT + 2);
        uint256 segmentCount;
        segments[segmentCount++] =
            bytes('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">');

        for (uint8 slot = 0; slot < SLOT_COUNT; slot++) {
            (bytes memory fragmentData, bool isDsl) = _fragmentData(philId, slot);
            if (fragmentData.length == 0) continue;

            bytes memory materialized = fragmentData;
            if (isDsl) {
                materialized = bytes(PhilDSLDecoder.decode(fragmentData));
            }

            string memory renderedFragment = _applyPalette(
                materialized,
                paletteData,
                slotCount,
                paletteVariant,
                mixedOrder
            );
            bytes memory fragmentBytes = bytes(renderedFragment);
            if (fragmentBytes.length == 0) continue;
            segments[segmentCount++] = fragmentBytes;
        }

        segments[segmentCount++] = bytes("</svg>");
        return string(_concatBytes(segments, segmentCount));
    }

    function tokenURI(
        uint256 tokenId,
        uint8 philId,
        uint8 paletteVariant,
        uint8 mixMode,
        uint32 mixSeed
    ) external view returns (string memory) {
        string memory image;

        if (compactTokenURI && gateway != address(0)) {
            image = string(
                abi.encodePacked(
                    "web3://",
                    uint256(uint160(gateway)).toHexString(20),
                    "/svg/",
                    uint256(philId).toString(),
                    "/",
                    uint256(paletteVariant).toString(),
                    "/",
                    uint256(mixMode).toString(),
                    "/",
                    uint256(mixSeed).toString()
                )
            );
        } else {
            string memory svg = renderSvg(philId, paletteVariant, mixMode, mixSeed);
            image = string(
                abi.encodePacked(
                    "data:image/svg+xml;base64,",
                    Base64.encode(bytes(svg))
                )
            );
        }

        return string(
            abi.encodePacked(
                "data:application/json;utf8,",
                '{"name":"Phil #',
                tokenId.toString(),
                '","description":"Phil fragments renderer with on-chain palettes.",',
                '"attributes":[{"trait_type":"Phil ID","value":"',
                uint256(philId).toString(),
                '"},{"trait_type":"Palette","value":"',
                uint256(paletteVariant).toString(),
                '"},{"trait_type":"Mix Mode","value":"',
                uint256(mixMode).toString(),
                '"},{"trait_type":"Mix Seed","value":"',
                uint256(mixSeed).toString(),
                '"}],"image":"',
                image,
                '"}'
            )
        );
    }

    function renderHash(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        external
        view
        returns (bytes32)
    {
        return keccak256(bytes(renderSvg(philId, paletteVariant, mixMode, mixSeed)));
    }

    function _fragmentData(uint8 philId, uint8 slot)
        internal
        view
        returns (bytes memory out, bool isDsl)
    {
        (uint16 start, uint16 end, bool dsl) = fragments.fragmentRange(philId, slot);
        if (end <= start) {
            return (new bytes(0), dsl);
        }

        uint256 count = uint256(end - start);
        bytes[] memory parts = new bytes[](count);
        uint256 total;

        for (uint256 i = 0; i < count; i++) {
            bytes memory chunk = SSTORE2.read(fragments.chunkPtr(uint16(uint256(start) + i)));
            parts[i] = chunk;
            total += chunk.length;
        }

        out = new bytes(total);
        uint256 offset;
        for (uint256 i = 0; i < count; i++) {
            bytes memory part = parts[i];
            for (uint256 j = 0; j < part.length; j++) {
                out[offset + j] = part[j];
            }
            offset += part.length;
        }

        return (out, dsl);
    }

    function _concatBytes(bytes[] memory parts, uint256 count)
        internal
        pure
        returns (bytes memory out)
    {
        uint256 total;
        for (uint256 i = 0; i < count; i++) {
            total += parts[i].length;
        }

        out = new bytes(total);
        uint256 offset;
        for (uint256 i = 0; i < count; i++) {
            bytes memory part = parts[i];
            for (uint256 j = 0; j < part.length; j++) {
                out[offset + j] = part[j];
            }
            offset += part.length;
        }
    }

    function _applyPalette(
        bytes memory source,
        bytes memory paletteData,
        uint8 slotCount,
        uint8 paletteVariant,
        uint8[] memory mixedOrder
    ) internal pure returns (string memory) {
        // Worst case all bytes are slot tokens: 3 bytes -> 7 bytes, so 3x is safe.
        bytes memory out = new bytes(source.length * 3 + 16);
        uint256 outOffset;

        for (uint256 i = 0; i < source.length; i++) {
            (bool ok, uint8 slot) = _tryParseSlotToken(source, i, slotCount);
            if (!ok) {
                out[outOffset++] = source[i];
                continue;
            }

            uint256 colorOffset =
                (uint256(paletteVariant) * uint256(slotCount) + uint256(mixedOrder[slot])) * 3;

            out[outOffset++] = 0x23; // '#'
            _writeByteHex(out, outOffset, paletteData[colorOffset]);
            outOffset += 2;
            _writeByteHex(out, outOffset, paletteData[colorOffset + 1]);
            outOffset += 2;
            _writeByteHex(out, outOffset, paletteData[colorOffset + 2]);
            outOffset += 2;
            i += 2;
        }

        assembly ("memory-safe") {
            mstore(out, outOffset)
        }
        return string(out);
    }

    function _tryParseSlotToken(bytes memory data, uint256 index, uint8 slotCount)
        internal
        pure
        returns (bool ok, uint8 slot)
    {
        if (index + 2 >= data.length) return (false, 0);
        if (data[index] != 0x40) return (false, 0); // '@'

        bytes1 c1 = data[index + 1];
        bytes1 c2 = data[index + 2];
        if (!_isHex(c1) || !_isHex(c2)) return (false, 0);

        slot = (_fromHex(c1) << 4) | _fromHex(c2);
        if (slot >= slotCount) return (false, 0);
        return (true, slot);
    }

    function _writeByteHex(bytes memory out, uint256 offset, bytes1 value) internal pure {
        uint8 v = uint8(value);
        out[offset] = _toHex(v >> 4);
        out[offset + 1] = _toHex(v & 0x0f);
    }

    function _toHex(uint8 nibble) internal pure returns (bytes1) {
        return nibble < 10 ? bytes1(nibble + 48) : bytes1(nibble + 87);
    }

    function _isHex(bytes1 c) internal pure returns (bool) {
        return (c >= "0" && c <= "9")
            || (c >= "a" && c <= "f")
            || (c >= "A" && c <= "F");
    }

    function _fromHex(bytes1 c) internal pure returns (uint8) {
        if (c >= "0" && c <= "9") return uint8(c) - 48;
        if (c >= "a" && c <= "f") return uint8(c) - 87;
        return uint8(c) - 55;
    }

    function _nextRand(uint32 state) internal pure returns (uint32) {
        uint32 x = state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        return x;
    }

    function _buildMixedOrder(uint8 slotCount, uint8 mixMode, uint32 mixSeed)
        internal
        pure
        returns (uint8[] memory order)
    {
        order = new uint8[](slotCount);
        for (uint256 i = 0; i < slotCount; i++) {
            order[i] = uint8(i);
        }

        if (slotCount < 2 || mixMode == MIX_MODE_NONE) {
            return order;
        }

        uint32 state = mixSeed == 0 ? GOLDEN_MIX_SEED : mixSeed;

        if (mixMode == MIX_MODE_SWAP) {
            state = _nextRand(state);
            uint8 swaps = uint8((state % 3) + 1);
            for (uint8 i = 0; i < swaps; i++) {
                state = _nextRand(state);
                uint8 a = uint8(state % slotCount);
                state = _nextRand(state);
                uint8 b = uint8(state % slotCount);
                if (a == b) b = uint8((uint256(b) + 1) % slotCount);
                uint8 temp = order[a];
                order[a] = order[b];
                order[b] = temp;
            }
            return order;
        }

        for (uint256 i = uint256(slotCount - 1); i > 0; i--) {
            state = _nextRand(state);
            uint256 j = uint256(state) % (i + 1);
            uint8 temp = order[i];
            order[i] = order[j];
            order[j] = temp;
        }

        return order;
    }
}
