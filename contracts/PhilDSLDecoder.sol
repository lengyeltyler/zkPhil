// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PhilDSLDecoder
/// @notice Decodes compact binary DSL instructions into SVG fragment strings.
/// @dev Supports legacy v1 geometric DSL and v2 dictionary/literal DSL.
library PhilDSLDecoder {
    uint8 private constant VERSION_V1 = 0x01;
    uint8 private constant VERSION_V2 = 0x02;

    uint8 private constant OP_LITERAL = 0x10;
    uint8 private constant OP_DICT = 0x11;

    function decode(bytes memory dsl) internal pure returns (string memory) {
        require(dsl.length >= 3, "DSL: too short");
        uint8 version = uint8(dsl[0]);

        if (version == VERSION_V1) {
            return _decodeV1(dsl);
        }
        if (version == VERSION_V2) {
            return _decodeV2(dsl);
        }

        revert("DSL: bad version");
    }

    function _decodeV2(bytes memory dsl) private pure returns (string memory) {
        uint256 opCount = _u16LE(dsl, 1);

        // First pass: determine output length.
        uint256 pos = 3;
        uint256 outLen;
        for (uint256 i; i < opCount; i++) {
            require(pos < dsl.length, "DSL2: truncated");
            uint8 op = uint8(dsl[pos]);
            pos++;

            if (op == OP_LITERAL) {
                require(pos + 2 <= dsl.length, "DSL2: literal header");
                uint256 len = _u16LE(dsl, pos);
                pos += 2;
                require(pos + len <= dsl.length, "DSL2: literal payload");
                outLen += len;
                pos += len;
            } else if (op == OP_DICT) {
                require(pos < dsl.length, "DSL2: dict id");
                uint8 id = uint8(dsl[pos]);
                pos++;
                outLen += _dictToken(id).length;
            } else {
                revert("DSL2: bad opcode");
            }
        }

        // Second pass: decode into output buffer.
        bytes memory out = new bytes(outLen);
        pos = 3;
        uint256 offset;

        for (uint256 i; i < opCount; i++) {
            uint8 op = uint8(dsl[pos]);
            pos++;

            if (op == OP_LITERAL) {
                uint256 len = _u16LE(dsl, pos);
                pos += 2;
                for (uint256 j; j < len; j++) {
                    out[offset + j] = dsl[pos + j];
                }
                pos += len;
                offset += len;
            } else {
                uint8 id = uint8(dsl[pos]);
                pos++;
                bytes memory token = _dictToken(id);
                for (uint256 j; j < token.length; j++) {
                    out[offset + j] = token[j];
                }
                offset += token.length;
            }
        }

        return string(out);
    }

    function _dictToken(uint8 id) private pure returns (bytes memory) {
        if (id == 0) return bytes(" isolation=\"isolate\"");
        if (id == 1) return bytes(" stop-opacity=\"");
        if (id == 2) return bytes(" gradientUnits=\"userSpaceOnUse\"");
        if (id == 3) return bytes(" gradientTransform=\"");
        if (id == 4) return bytes(" transform=\"translate(");
        if (id == 5) return bytes(" fill=\"#ffffff\"");
        if (id == 6) return bytes(" fill=\"#000000\"");
        if (id == 7) return bytes("<radialGradient ");
        if (id == 8) return bytes("<linearGradient ");
        if (id == 9) return bytes("<pattern ");
        if (id == 10) return bytes("<ellipse cx=\"");
        if (id == 11) return bytes("<circle cx=\"");
        if (id == 12) return bytes("<path d=\"");
        if (id == 13) return bytes("<rect ");
        if (id == 14) return bytes("<stop offset=\"");
        if (id == 15) return bytes(" opacity=\"");
        if (id == 16) return bytes(" stroke=\"#");
        if (id == 17) return bytes(" fill=\"url(#");
        if (id == 18) return bytes(" stop-color=\"#");
        if (id == 19) return bytes(" stroke-width=\"");
        if (id == 20) return bytes(" xlink:href=\"#");
        if (id == 21) return bytes(" href=\"#");
        if (id == 22) return bytes(" fill=\"#");
        if (id == 23) return bytes(" cx=\"");
        if (id == 24) return bytes(" cy=\"");
        if (id == 25) return bytes(" rx=\"");
        if (id == 26) return bytes(" ry=\"");
        if (id == 27) return bytes(" r=\"");
        if (id == 28) return bytes(" x=\"");
        if (id == 29) return bytes(" y=\"");
        if (id == 30) return bytes(" width=\"");
        if (id == 31) return bytes(" height=\"");
        if (id == 32) return bytes(" id=\"");
        if (id == 33) return bytes(" url(#");
        if (id == 34) return bytes("\"/>");
        if (id == 35) return bytes("\" />");
        if (id == 36) return bytes("\"");
        if (id == 37) return bytes("</g>");
        if (id == 38) return bytes("<g ");
        if (id == 39) return bytes("<defs>");
        if (id == 40) return bytes("</defs>");
        if (id == 41) return bytes("<g>");
        if (id == 42) return bytes("/>");

        revert("DSL2: bad dict id");
    }

    function _decodeV1(bytes memory dsl) private pure returns (string memory) {
        uint256 opCount = _u16LE(dsl, 1);
        uint256 pos = 3;
        bytes memory out = new bytes(dsl.length * 12);
        uint256 outLen;

        for (uint256 i; i < opCount; i++) {
            require(pos < dsl.length, "DSL: truncated");
            uint8 op = uint8(dsl[pos]);
            pos++;

            if (op == 0x01) {
                uint256 cx = _u16LE(dsl, pos); pos += 2;
                uint256 cy = _u16LE(dsl, pos); pos += 2;
                uint256 rx = uint8(dsl[pos]); pos += 1;
                uint256 ry = uint8(dsl[pos]); pos += 1;

                outLen = _appendStr(out, outLen, '<ellipse cx="');
                outLen = _appendFixed100(out, outLen, cx);
                outLen = _appendStr(out, outLen, '" cy="');
                outLen = _appendFixed100(out, outLen, cy);
                outLen = _appendStr(out, outLen, '" rx="');
                outLen = _appendFixed10(out, outLen, rx);
                outLen = _appendStr(out, outLen, '" ry="');
                outLen = _appendFixed10(out, outLen, ry);
                outLen = _appendStr(out, outLen, '"/>');
            } else if (op == 0x05) {
                uint256 cx = _u16LE(dsl, pos); pos += 2;
                uint256 cy = _u16LE(dsl, pos); pos += 2;
                uint256 r = uint8(dsl[pos]); pos += 1;

                outLen = _appendStr(out, outLen, '<circle cx="');
                outLen = _appendFixed100(out, outLen, cx);
                outLen = _appendStr(out, outLen, '" cy="');
                outLen = _appendFixed100(out, outLen, cy);
                outLen = _appendStr(out, outLen, '" r="');
                outLen = _appendFixed10(out, outLen, r);
                outLen = _appendStr(out, outLen, '"/>');
            } else if (op == 0x02) {
                uint256 x = _u16LE(dsl, pos); pos += 2;
                uint256 y = _u16LE(dsl, pos); pos += 2;
                int16 dx1 = _i16LE(dsl, pos); pos += 2;
                int16 dy1 = _i16LE(dsl, pos); pos += 2;
                int16 dx2 = _i16LE(dsl, pos); pos += 2;

                outLen = _appendStr(out, outLen, '<path d="M');
                outLen = _appendFixed100(out, outLen, x);
                outLen = _appendByte(out, outLen, " ");
                outLen = _appendFixed100(out, outLen, y);
                outLen = _appendByte(out, outLen, "l");
                outLen = _appendSignedFixed100(out, outLen, dx1);
                outLen = _appendByte(out, outLen, " ");
                outLen = _appendSignedFixed100(out, outLen, dy1);
                outLen = _appendByte(out, outLen, "h");
                outLen = _appendSignedFixed100(out, outLen, dx2);
                outLen = _appendStr(out, outLen, 'Z"/>');
            } else if (op == 0x03) {
                uint256 cxRaw = _u16LE(dsl, pos); pos += 2;
                uint256 cyRaw = _u16LE(dsl, pos); pos += 2;
                uint256 sz = uint8(dsl[pos]); pos += 1;

                uint256 s100 = sz * 10;
                uint256 h100 = (sz * 866) / 100;
                uint256 s2 = s100 / 2;

                outLen = _appendStr(out, outLen, '<path d="M');
                if (cxRaw >= s100) {
                    outLen = _appendFixed100(out, outLen, cxRaw - s100);
                } else {
                    outLen = _appendFixed100(out, outLen, 0);
                }
                outLen = _appendByte(out, outLen, " ");
                outLen = _appendFixed100(out, outLen, cyRaw);
                outLen = _appendByte(out, outLen, "l");
                outLen = _appendFixed100(out, outLen, s2);
                outLen = _appendByte(out, outLen, " ");
                outLen = _appendByte(out, outLen, "-");
                outLen = _appendFixed100(out, outLen, h100);
                outLen = _appendByte(out, outLen, "h");
                outLen = _appendFixed100(out, outLen, s100);
                outLen = _appendByte(out, outLen, "l");
                outLen = _appendFixed100(out, outLen, s2);
                outLen = _appendByte(out, outLen, " ");
                outLen = _appendFixed100(out, outLen, h100);
                outLen = _appendStr(out, outLen, "l-");
                outLen = _appendFixed100(out, outLen, s2);
                outLen = _appendByte(out, outLen, " ");
                outLen = _appendFixed100(out, outLen, h100);
                outLen = _appendStr(out, outLen, "h-");
                outLen = _appendFixed100(out, outLen, s100);
                outLen = _appendStr(out, outLen, 'Z"/>');
            } else if (op == 0x08) {
                uint256 len = _u16LE(dsl, pos); pos += 2;
                outLen = _appendBytes(out, outLen, dsl, pos, len);
                pos += len;
            } else if (op == 0x09) {
                uint256 len = _u16LE(dsl, pos); pos += 2;
                outLen = _appendStr(out, outLen, '<path d="');
                outLen = _appendBytes(out, outLen, dsl, pos, len);
                pos += len;
                outLen = _appendStr(out, outLen, '"/>');
            } else {
                revert("DSL: unknown opcode");
            }
        }

        assembly ("memory-safe") { mstore(out, outLen) }
        return string(out);
    }

    function _u16LE(bytes memory b, uint256 offset) private pure returns (uint256) {
        return uint8(b[offset]) | (uint256(uint8(b[offset + 1])) << 8);
    }

    function _i16LE(bytes memory b, uint256 offset) private pure returns (int16) {
        uint16 raw = uint16(uint8(b[offset])) | (uint16(uint8(b[offset + 1])) << 8);
        return int16(raw);
    }

    function _appendStr(bytes memory out, uint256 outLen, string memory s) private pure returns (uint256) {
        bytes memory sb = bytes(s);
        for (uint256 i; i < sb.length; i++) {
            out[outLen + i] = sb[i];
        }
        return outLen + sb.length;
    }

    function _appendByte(bytes memory out, uint256 outLen, string memory s) private pure returns (uint256) {
        out[outLen] = bytes(s)[0];
        return outLen + 1;
    }

    function _appendBytes(bytes memory out, uint256 outLen, bytes memory src, uint256 srcOffset, uint256 len) private pure returns (uint256) {
        for (uint256 i; i < len; i++) {
            out[outLen + i] = src[srcOffset + i];
        }
        return outLen + len;
    }

    function _appendFixed100(bytes memory out, uint256 outLen, uint256 val) private pure returns (uint256) {
        uint256 whole = val / 100;
        uint256 frac = val % 100;

        outLen = _appendUint(out, outLen, whole);
        if (frac > 0) {
            out[outLen++] = ".";
            if (frac % 10 == 0) {
                outLen = _appendUint(out, outLen, frac / 10);
            } else {
                if (frac < 10) {
                    out[outLen++] = "0";
                }
                outLen = _appendUint(out, outLen, frac);
            }
        }

        return outLen;
    }

    function _appendFixed10(bytes memory out, uint256 outLen, uint256 val) private pure returns (uint256) {
        uint256 whole = val / 10;
        uint256 frac = val % 10;

        outLen = _appendUint(out, outLen, whole);
        if (frac > 0) {
            out[outLen++] = ".";
            outLen = _appendUint(out, outLen, frac);
        }
        return outLen;
    }

    function _appendSignedFixed100(bytes memory out, uint256 outLen, int16 val) private pure returns (uint256) {
        if (val < 0) {
            out[outLen++] = "-";
            return _appendFixed100(out, outLen, uint256(uint16(-val)));
        }
        return _appendFixed100(out, outLen, uint256(uint16(val)));
    }

    function _appendUint(bytes memory out, uint256 outLen, uint256 val) private pure returns (uint256) {
        if (val == 0) {
            out[outLen++] = "0";
            return outLen;
        }

        uint256 temp = val;
        uint256 digits;
        while (temp > 0) {
            digits++;
            temp /= 10;
        }

        uint256 end = outLen + digits;
        temp = val;
        for (uint256 i = end; i > outLen; i--) {
            out[i - 1] = bytes1(uint8(48 + (temp % 10)));
            temp /= 10;
        }

        return end;
    }
}
