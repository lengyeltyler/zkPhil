// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {SSTORE2} from "solady/src/utils/SSTORE2.sol";

contract PhilSVGStorage is Ownable {
    uint256 public constant SINGLE_UPLOAD_LIMIT = 24_576;
    uint256 internal constant STORAGE_CHUNK_LIMIT = 24_575;

    struct SvgRecord {
        uint40 totalSize;
        uint40 storedSize;
        uint16 expectedChunks;
        bool finalized;
        bytes32 contentHash;
        address[] chunkPointers;
    }

    uint256 public nextSvgId;

    mapping(uint256 => SvgRecord) private _records;
    mapping(bytes32 => uint256) public svgIdForHash;

    error ChunkLimitExceeded(uint256 chunkSize);
    error ContentHashMismatch(bytes32 expectedHash, bytes32 actualHash);
    error EmptySvg();
    error RecordNotFinalized(uint256 svgId);
    error TooLargeForSingleUpload(uint256 actualSize);
    error TooManyChunks(uint256 svgId);
    error UnknownSvgId(uint256 svgId);
    error UploadAlreadyFinalized(uint256 svgId);
    error UploadInProgress(uint256 svgId);
    error UploadMetadataMismatch(uint256 svgId);

    event ChunkedUploadInitialized(
        uint256 indexed svgId,
        bytes32 indexed contentHash,
        uint256 totalSize,
        uint256 expectedChunks
    );
    event SvgChunkStored(
        uint256 indexed svgId,
        uint256 indexed chunkIndex,
        address pointer,
        uint256 chunkSize
    );
    event SvgStored(
        uint256 indexed svgId,
        bytes32 indexed contentHash,
        uint256 totalSize,
        bool chunked
    );

    constructor(address initialOwner) {
        _initializeOwner(initialOwner);
    }

    function storeSvg(bytes calldata svg) external onlyOwner returns (uint256 svgId) {
        svgId = _storeSvg(svg);
    }

    function storeSvgBatch(bytes[] calldata svgs) external onlyOwner returns (uint256[] memory svgIds) {
        svgIds = new uint256[](svgs.length);
        for (uint256 index = 0; index < svgs.length; index++) {
            svgIds[index] = _storeSvg(svgs[index]);
        }
    }

    function _storeSvg(bytes calldata svg) internal returns (uint256 svgId) {
        if (svg.length == 0) revert EmptySvg();
        if (svg.length > SINGLE_UPLOAD_LIMIT) revert TooLargeForSingleUpload(svg.length);

        bytes32 contentHash = keccak256(svg);
        uint256 existingSvgId = svgIdForHash[contentHash];
        if (existingSvgId != 0) {
            SvgRecord storage existingRecord = _records[existingSvgId];
            if (!existingRecord.finalized) revert UploadInProgress(existingSvgId);
            return existingSvgId;
        }

        svgId = _createRecord(uint40(svg.length), uint16(1), contentHash);
        SvgRecord storage record = _records[svgId];
        record.storedSize = uint40(svg.length);
        uint256 chunkCount = _writeInSingleTransaction(record, svg);
        record.expectedChunks = uint16(chunkCount);
        record.finalized = true;

        for (uint256 chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
            emit SvgChunkStored(
                svgId,
                chunkIndex,
                record.chunkPointers[chunkIndex],
                chunkIndex + 1 == chunkCount
                    ? svg.length - (chunkIndex * STORAGE_CHUNK_LIMIT)
                    : STORAGE_CHUNK_LIMIT
            );
        }
        emit SvgStored(svgId, contentHash, svg.length, false);
    }

    function initializeChunkedSvg(
        uint256 totalSize,
        bytes32 contentHash,
        uint16 expectedChunks
    ) external onlyOwner returns (uint256 svgId) {
        if (totalSize == 0) revert EmptySvg();
        if (expectedChunks == 0) revert UploadMetadataMismatch(0);

        uint256 existingSvgId = svgIdForHash[contentHash];
        if (existingSvgId != 0) {
            SvgRecord storage existingRecord = _records[existingSvgId];
            if (
                existingRecord.totalSize != totalSize ||
                existingRecord.expectedChunks != expectedChunks
            ) {
                revert UploadMetadataMismatch(existingSvgId);
            }
            return existingSvgId;
        }

        svgId = _createRecord(uint40(totalSize), expectedChunks, contentHash);
        emit ChunkedUploadInitialized(svgId, contentHash, totalSize, expectedChunks);
    }

    function appendChunk(uint256 svgId, bytes calldata chunk) external onlyOwner {
        _appendChunk(svgId, chunk);
    }

    function appendChunks(uint256 svgId, bytes[] calldata chunks) external onlyOwner {
        for (uint256 index = 0; index < chunks.length; index++) {
            _appendChunk(svgId, chunks[index]);
        }
    }

    function _appendChunk(uint256 svgId, bytes calldata chunk) internal {
        if (chunk.length == 0) revert EmptySvg();
        if (chunk.length > STORAGE_CHUNK_LIMIT) revert ChunkLimitExceeded(chunk.length);

        SvgRecord storage record = _records[svgId];
        if (record.contentHash == bytes32(0)) revert UnknownSvgId(svgId);
        if (record.finalized) revert UploadAlreadyFinalized(svgId);
        if (record.chunkPointers.length >= record.expectedChunks) revert TooManyChunks(svgId);

        address pointer = SSTORE2.write(chunk);
        record.chunkPointers.push(pointer);
        record.storedSize += uint40(chunk.length);

        emit SvgChunkStored(svgId, record.chunkPointers.length - 1, pointer, chunk.length);
    }

    function finalizeChunkedSvg(uint256 svgId) external onlyOwner {
        SvgRecord storage record = _records[svgId];
        if (record.contentHash == bytes32(0)) revert UnknownSvgId(svgId);
        if (record.finalized) revert UploadAlreadyFinalized(svgId);
        if (record.chunkPointers.length != record.expectedChunks) revert TooManyChunks(svgId);
        if (record.storedSize != record.totalSize) revert UploadMetadataMismatch(svgId);

        bytes memory assembled = _readRecord(record);
        bytes32 actualHash = keccak256(assembled);
        if (actualHash != record.contentHash) {
            revert ContentHashMismatch(record.contentHash, actualHash);
        }

        record.finalized = true;
        emit SvgStored(svgId, record.contentHash, record.totalSize, true);
    }

    function getRecord(uint256 svgId)
        external
        view
        returns (
            uint256 totalSize,
            uint256 storedSize,
            uint256 expectedChunks,
            uint256 chunkCount,
            bool finalized,
            bytes32 contentHash
        )
    {
        SvgRecord storage record = _records[svgId];
        if (record.contentHash == bytes32(0)) revert UnknownSvgId(svgId);

        totalSize = record.totalSize;
        storedSize = record.storedSize;
        expectedChunks = record.expectedChunks;
        chunkCount = record.chunkPointers.length;
        finalized = record.finalized;
        contentHash = record.contentHash;
    }

    function getChunkPointers(uint256 svgId) external view returns (address[] memory) {
        SvgRecord storage record = _records[svgId];
        if (record.contentHash == bytes32(0)) revert UnknownSvgId(svgId);
        return record.chunkPointers;
    }

    function readSvgBytes(uint256 svgId) public view returns (bytes memory) {
        SvgRecord storage record = _records[svgId];
        if (record.contentHash == bytes32(0)) revert UnknownSvgId(svgId);
        if (!record.finalized) revert RecordNotFinalized(svgId);
        return _readRecord(record);
    }

    function readSvg(uint256 svgId) external view returns (string memory) {
        return string(readSvgBytes(svgId));
    }

    function _createRecord(
        uint40 totalSize,
        uint16 expectedChunks,
        bytes32 contentHash
    ) internal returns (uint256 svgId) {
        svgId = ++nextSvgId;
        SvgRecord storage record = _records[svgId];
        record.totalSize = totalSize;
        record.expectedChunks = expectedChunks;
        record.contentHash = contentHash;
        svgIdForHash[contentHash] = svgId;
    }

    function _readRecord(SvgRecord storage record) internal view returns (bytes memory output) {
        output = new bytes(record.totalSize);
        uint256 offset;

        for (uint256 index = 0; index < record.chunkPointers.length; index++) {
            bytes memory chunk = SSTORE2.read(record.chunkPointers[index]);
            _copyBytes(output, offset, chunk);
            offset += chunk.length;
        }
    }

    function _writeInSingleTransaction(SvgRecord storage record, bytes calldata svg)
        internal
        returns (uint256 chunkCount)
    {
        if (svg.length <= STORAGE_CHUNK_LIMIT) {
            record.chunkPointers.push(SSTORE2.write(svg));
            return 1;
        }

        for (uint256 offset = 0; offset < svg.length; offset += STORAGE_CHUNK_LIMIT) {
            uint256 end = offset + STORAGE_CHUNK_LIMIT;
            if (end > svg.length) {
                end = svg.length;
            }

            record.chunkPointers.push(SSTORE2.write(svg[offset:end]));
            chunkCount++;
        }
    }

    function _copyBytes(bytes memory destination, uint256 offset, bytes memory source) internal pure {
        uint256 length = source.length;
        if (length == 0) {
            return;
        }

        assembly {
            let destPointer := add(add(destination, 0x20), offset)
            let sourcePointer := add(source, 0x20)
            let endPointer := add(sourcePointer, length)

            for {} lt(sourcePointer, endPointer) {} {
                mstore(destPointer, mload(sourcePointer))
                sourcePointer := add(sourcePointer, 0x20)
                destPointer := add(destPointer, 0x20)
            }
        }
    }
}
