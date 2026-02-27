// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PhilFragments
/// @notice Registry for per-Phil fragment payloads stored as SSTORE2 pointers.
/// @dev Fixed slot layout per phil:
///  0 BgColor, 1 BgNebula, 2 BgStars, 3 BgDust,
///  4 Body, 5 BodyShapes, 6 Eyes, 7 JawLine, 8 Spikes, 9 Teeth, 10 Top
contract PhilFragments {
    uint8 public constant PHIL_COUNT = 6;
    uint8 public constant SLOT_COUNT = 11;
    uint16 public constant FRAGMENT_COUNT = uint16(PHIL_COUNT * SLOT_COUNT); // 66

    address[] internal _chunks;
    uint16[67] internal _offsets;
    uint8[66] internal _dslFlags;

    error InvalidOffsets();
    error InvalidChunkPointer();
    error BadPhilId();
    error BadSlot();
    error BadChunkIndex();

    constructor(
        address[] memory chunks,
        uint16[67] memory offsets,
        uint8[66] memory dslFlags
    ) {
        if (offsets[0] != 0) revert InvalidOffsets();
        uint16 prev = offsets[0];
        for (uint256 i = 1; i < offsets.length; i++) {
            uint16 cur = offsets[i];
            if (cur < prev) revert InvalidOffsets();
            prev = cur;
        }
        if (uint256(offsets[offsets.length - 1]) != chunks.length) revert InvalidOffsets();

        for (uint256 i = 0; i < chunks.length; i++) {
            if (chunks[i] == address(0)) revert InvalidChunkPointer();
            _chunks.push(chunks[i]);
        }

        for (uint256 i = 0; i < offsets.length; i++) {
            _offsets[i] = offsets[i];
        }

        for (uint256 i = 0; i < dslFlags.length; i++) {
            _dslFlags[i] = dslFlags[i] == 0 ? 0 : 1;
        }
    }

    function chunkCount() external view returns (uint256) {
        return _chunks.length;
    }

    function chunkPtr(uint16 chunkIndex) external view returns (address) {
        if (chunkIndex >= _chunks.length) revert BadChunkIndex();
        return _chunks[chunkIndex];
    }

    function fragmentRange(uint8 philId, uint8 slot)
        external
        view
        returns (uint16 start, uint16 end, bool isDsl)
    {
        uint16 index = _fragmentIndex(philId, slot);
        start = _offsets[index];
        end = _offsets[index + 1];
        isDsl = _dslFlags[index] == 1;
    }

    function isDsl(uint8 philId, uint8 slot) external view returns (bool) {
        uint16 index = _fragmentIndex(philId, slot);
        return _dslFlags[index] == 1;
    }

    function offsets() external view returns (uint16[67] memory) {
        return _offsets;
    }

    function _fragmentIndex(uint8 philId, uint8 slot) internal pure returns (uint16) {
        if (philId >= PHIL_COUNT) revert BadPhilId();
        if (slot >= SLOT_COUNT) revert BadSlot();
        return uint16(uint256(philId) * SLOT_COUNT + slot);
    }
}
