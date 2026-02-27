// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SSTORE2} from "solady/src/utils/SSTORE2.sol";

/// @title PhilPalettes
/// @notice Palette storage contract using packed bytes3 colors in SSTORE2 blobs.
/// @dev Data layout per phil blob: [palette0 slots...][palette1 slots...] ... [palette8 slots...]
contract PhilPalettes {
    uint8 public constant PHIL_COUNT = 6;
    uint8 public constant PALETTE_COUNT = 9;

    address[PHIL_COUNT] internal _palettePointers;
    uint8[PHIL_COUNT] internal _slotCounts;

    error BadPhilId();
    error BadPaletteId();
    error BadSlot();
    error BadPointer();
    error BadData();

    constructor(address[PHIL_COUNT] memory palettePointers, uint8[PHIL_COUNT] memory slotCounts) {
        for (uint256 i = 0; i < PHIL_COUNT; i++) {
            if (palettePointers[i] == address(0)) revert BadPointer();
            if (slotCounts[i] == 0) revert BadData();
            _palettePointers[i] = palettePointers[i];
            _slotCounts[i] = slotCounts[i];
        }
    }

    function palettePointer(uint8 philId) external view returns (address) {
        if (philId >= PHIL_COUNT) revert BadPhilId();
        return _palettePointers[philId];
    }

    function slotCount(uint8 philId) external view returns (uint8) {
        if (philId >= PHIL_COUNT) revert BadPhilId();
        return _slotCounts[philId];
    }

    function paletteData(uint8 philId) external view returns (bytes memory) {
        if (philId >= PHIL_COUNT) revert BadPhilId();
        return SSTORE2.read(_palettePointers[philId]);
    }

    function colorAt(uint8 philId, uint8 paletteId, uint8 slot) external view returns (bytes3) {
        if (philId >= PHIL_COUNT) revert BadPhilId();
        if (paletteId >= PALETTE_COUNT) revert BadPaletteId();

        uint8 slotCount_ = _slotCounts[philId];
        if (slot >= slotCount_) revert BadSlot();

        bytes memory data = SSTORE2.read(_palettePointers[philId]);
        uint256 expected = uint256(slotCount_) * PALETTE_COUNT * 3;
        if (data.length < expected) revert BadData();

        uint256 offset = (uint256(paletteId) * uint256(slotCount_) + uint256(slot)) * 3;
        uint24 rgb = (uint24(uint8(data[offset])) << 16)
            | (uint24(uint8(data[offset + 1])) << 8)
            | uint24(uint8(data[offset + 2]));
        return bytes3(rgb);
    }
}
