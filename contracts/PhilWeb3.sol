// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC4804 {
    function read(string calldata path) external view returns (string memory, bytes memory);
}

interface IPhilRendererRead {
    function renderSvg(uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed)
        external
        view
        returns (string memory);
}

/// @notice Minimal ERC-4804 gateway.
/// Supports:
/// - web3://<this>/svg/<philId>/<paletteVariant>
/// - web3://<this>/svg/<philId>/<paletteVariant>/<mixMode>/<mixSeed>
contract PhilWeb3 is IERC4804 {
    IPhilRendererRead public immutable renderer;

    constructor(address renderer_) {
        renderer = IPhilRendererRead(renderer_);
    }

    function read(string calldata path) external view returns (string memory mime, bytes memory data) {
        bytes memory p = bytes(path);

        // Support /svg/<philId>/<paletteVariant>[/<mixMode>/<mixSeed>]
        if (_startsWith(p, "/svg/")) {
            (uint256 philId, uint256 pos) = _parseUint(path, 5);
            (uint256 paletteVariant, uint256 pos2) = _parseUint(path, pos + 1);
            uint256 mixMode = 0;
            uint256 mixSeed = 0;
            if (pos2 < p.length && p[pos2] == "/") {
                (mixMode, pos2) = _parseUint(path, pos2 + 1);
                if (pos2 < p.length && p[pos2] == "/") {
                    (mixSeed,) = _parseUint(path, pos2 + 1);
                }
            }
            string memory svg = renderer.renderSvg(
                uint8(philId),
                uint8(paletteVariant),
                uint8(mixMode),
                uint32(mixSeed)
            );
            return ("image/svg+xml", bytes(svg));
        }

        return ("text/plain", bytes("not found"));
    }

    function _startsWith(bytes memory s, string memory prefix) internal pure returns (bool) {
        bytes memory pfx = bytes(prefix);
        if (s.length < pfx.length) return false;
        for (uint256 i; i < pfx.length; i++) {
            if (s[i] != pfx[i]) return false;
        }
        return true;
    }

    function _parseUint(string calldata str, uint256 start) internal pure returns (uint256 value, uint256 endPos) {
        bytes memory b = bytes(str);
        uint256 x;
        uint256 i = start;
        for (; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c < 48 || c > 57) break;
            x = x * 10 + (c - 48);
        }
        return (x, i);
    }
}
