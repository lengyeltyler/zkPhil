#!/usr/bin/env node
/**
 * svg-to-dsl.mjs — Converts SVG fragment files into compact binary DSL format.
 *
 * Usage:
 *   node scripts/svg-to-dsl.mjs --in Fragments --out Fragments/dsl
 *
 * DSL Binary Format:
 *   Header:  [version:u8] [instructionCount:u16-LE]
 *   Body:    sequence of opcode + params
 *
 * Opcodes:
 *   0x01 ELLIPSE   cx:u16 cy:u16 rx:u8 ry:u8          (7 bytes)
 *   0x02 TRIANGLE  x:i16 y:i16 dx1:i16 dy1:i16 dx2:i16 (11 bytes)
 *   0x03 HEXAGON   cx:u16 cy:u16 size:u8               (6 bytes)
 *   0x04 RECT      x:u16 y:u16 w:u16 h:u16             (9 bytes)
 *   0x05 CIRCLE    cx:u16 cy:u16 r:u8                   (6 bytes)
 *   0x08 RAW_PATH  len:u16 data:bytes                   (3+len bytes)
 *
 * Coordinates: fixed-point x100 for u16 (0-42000 maps to 0.00-420.00)
 * Radii: fixed-point x100 for u8->u16, or x10 for u8 (0-255 maps to 0.0-25.5)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

// --- Opcode constants ---
const OP_ELLIPSE  = 0x01;
const OP_TRIANGLE = 0x02;
const OP_HEXAGON  = 0x03;
const OP_RECT     = 0x04;
const OP_CIRCLE   = 0x05;
const OP_RAW_PATH = 0x08;

const DSL_VERSION = 0x01;

// Eligible fragment basenames (without .frag.svg)
// Only fragments with significant geometric repetition benefit from DSL.
const ELIGIBLE = new Set([
  "bgstars1",
  "bgdust1",
  "bodyshapes1",
]);

// --- Coordinate encoding ---
// We use x100 fixed point for coordinates (2 decimal places, range 0-420.00 → 0-42000)
// stored as uint16 LE. For radii we use x100 stored as uint16 LE (range 0-25.5 → 0-2550)
// But to save space for radii that fit in 1 byte, ELLIPSE/CIRCLE use x10 in uint8.

function encodeCoord(val) {
  // fixed-point x100, clamped to uint16
  return Math.round(val * 100) & 0xFFFF;
}

function encodeRadius8(val) {
  // fixed-point x10, clamped to uint8 (max 25.5)
  return Math.min(255, Math.round(val * 10)) & 0xFF;
}

function encodeSignedCoord(val) {
  // fixed-point x100 as signed int16
  return Math.round(val * 100) & 0xFFFF;
}

// --- SVG Parsing ---

function parseEllipses(svg) {
  const results = [];
  const re = /<ellipse\s+cx="([^"]+)"\s+cy="([^"]+)"\s+rx="([^"]+)"\s+ry="([^"]+)"[^/]*\/>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    results.push({
      cx: parseFloat(m[1]),
      cy: parseFloat(m[2]),
      rx: parseFloat(m[3]),
      ry: parseFloat(m[4])
    });
  }
  return results;
}

function parseCircles(svg) {
  const results = [];
  const re = /<circle\s+cx="([^"]+)"\s+cy="([^"]+)"\s+r="([^"]+)"[^/]*\/>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    results.push({
      cx: parseFloat(m[1]),
      cy: parseFloat(m[2]),
      r: parseFloat(m[3])
    });
  }
  return results;
}

function parseCirclePaths(svg) {
  // Some stars are encoded as <path d="M... c ..."/> that represent circles
  // We'll skip these complex paths and handle them as RAW_PATH
  return [];
}

/**
 * Parse SVG path number sequences. Handles cases like:
 * "-4.17-7.22" → [-4.17, -7.22]
 * "8.33" → [8.33]
 */
function parseNumbers(str) {
  const nums = [];
  const re = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    nums.push(parseFloat(m[0]));
  }
  return nums;
}

/**
 * Parse the bodyTriangles mega-path format.
 * Uses relative 'm' after z, so we track the "current subpath start" position.
 * Each triangle subpath: m<relX> <relY><dx1><dy1>h<dx2>z
 * After z, the current point resets to the start of the previous subpath.
 * The next relative 'm' moves from that point.
 */
function parseTriangleMegaPath(pathData) {
  const triangles = [];

  // Split on 'z' to get subpaths, keeping track of whether first command is M or m
  const subpaths = pathData.split(/[zZ]/).filter(s => s.trim());

  let curX = 0, curY = 0; // tracks the "subpath start" after each z

  for (const sub of subpaths) {
    const trimmed = sub.trim();

    // Detect M (absolute) vs m (relative)
    const isAbsolute = trimmed[0] === "M";
    const afterCmd = trimmed.slice(1);

    // Extract the move coords and the rest
    // Pattern: <num> <num><dx1><dy1>h<dx2>
    const hIdx = afterCmd.search(/[hH]/);
    if (hIdx === -1) continue; // no h command = not a simple triangle

    const moveAndLine = afterCmd.slice(0, hIdx);
    const hPart = afterCmd.slice(hIdx + 1);

    const nums = parseNumbers(moveAndLine);
    if (nums.length < 4) continue;

    const moveX = nums[0];
    const moveY = nums[1];
    const dx1 = nums[2];
    const dy1 = nums[3];

    const hNums = parseNumbers(hPart);
    if (hNums.length < 1) continue;
    const dx2 = hNums[0];

    // Calculate absolute triangle start position
    let absX, absY;
    if (isAbsolute) {
      absX = moveX;
      absY = moveY;
    } else {
      absX = curX + moveX;
      absY = curY + moveY;
    }

    triangles.push({
      x: absX,
      y: absY,
      dx1,
      dy1,
      dx2
    });

    // After 'z', current point returns to start of this subpath
    curX = absX;
    curY = absY;
  }

  return triangles;
}

/**
 * Parse hexagon subpaths from bodyHexagons format.
 * Each hexagon: m<cx> <cy>-<s1>-<s2> <s1>-<s2>h<s3>l<s1> <s2>-<s1> <s2>z
 * Example: m135 186.47-5.06-8.9 5.06-8.9h10.11l5.06 8.9-5.06 8.9z
 */
function parseHexagonPaths(pathData) {
  const hexagons = [];
  const subpaths = pathData.split(/[zZ]/).filter(s => s.trim());

  for (const sub of subpaths) {
    const trimmed = sub.trim();
    const moveMatch = trimmed.match(/^[mM]\s*([-\d.]+)\s+([-\d.]+)(.*)/);
    if (!moveMatch) continue;

    const startX = parseFloat(moveMatch[1]);
    const startY = parseFloat(moveMatch[2]);
    const rest = moveMatch[3].trim();

    // Try to detect hexagon pattern: 6-sided shape with h command
    // Hexagons have a characteristic pattern with 'h' for the flat top/bottom
    if (rest.includes('h') && rest.includes('l')) {
      // Extract the hex size from the h command
      const hMatch = rest.match(/[hH]\s*([-\d.]+)/);
      if (hMatch) {
        const hWidth = Math.abs(parseFloat(hMatch[1]));
        // Hexagon center is offset from the start point
        // The start point is top-left of the hexagon
        // Center x = startX + hWidth/2, center y = startY (approximately)
        hexagons.push({
          cx: startX + hWidth / 2,
          cy: startY,
          size: encodeRadius8(hWidth / 2)
        });
      }
    }
  }

  return hexagons;
}

// --- Encoding functions ---

function encodeEllipseOp(e) {
  const buf = Buffer.alloc(7);
  buf.writeUInt8(OP_ELLIPSE, 0);
  buf.writeUInt16LE(encodeCoord(e.cx), 1);
  buf.writeUInt16LE(encodeCoord(e.cy), 3);
  buf.writeUInt8(encodeRadius8(e.rx), 5);
  buf.writeUInt8(encodeRadius8(e.ry), 6);
  return buf;
}

function encodeCircleOp(e) {
  const buf = Buffer.alloc(6);
  buf.writeUInt8(OP_CIRCLE, 0);
  buf.writeUInt16LE(encodeCoord(e.cx), 1);
  buf.writeUInt16LE(encodeCoord(e.cy), 3);
  buf.writeUInt8(encodeRadius8(e.rx), 5);
  return buf;
}

function encodeTriangleOp(t) {
  const buf = Buffer.alloc(11);
  buf.writeUInt8(OP_TRIANGLE, 0);
  buf.writeUInt16LE(encodeCoord(t.x), 1);    // absolute position (unsigned)
  buf.writeUInt16LE(encodeCoord(t.y), 3);    // absolute position (unsigned)
  buf.writeInt16LE(Math.round(t.dx1 * 100), 5);  // signed offset
  buf.writeInt16LE(Math.round(t.dy1 * 100), 7);  // signed offset
  buf.writeInt16LE(Math.round(t.dx2 * 100), 9);  // signed offset (h command)
  return buf;
}

function encodeHexagonOp(h) {
  const buf = Buffer.alloc(6);
  buf.writeUInt8(OP_HEXAGON, 0);
  buf.writeUInt16LE(encodeCoord(h.cx), 1);
  buf.writeUInt16LE(encodeCoord(h.cy), 3);
  buf.writeUInt8(h.size, 5);
  return buf;
}

function encodeRawPathOp(svgStr) {
  const data = Buffer.from(svgStr, "utf8");
  const buf = Buffer.alloc(3 + data.length);
  buf.writeUInt8(OP_RAW_PATH, 0);
  buf.writeUInt16LE(data.length, 1);
  data.copy(buf, 3);
  return buf;
}

/** Encode just a path d-attribute as a raw path (decoder wraps in <path d="..."/>) */
const OP_RAW_D = 0x09;
function encodeRawDOp(dAttr) {
  const data = Buffer.from(dAttr, "utf8");
  const buf = Buffer.alloc(3 + data.length);
  buf.writeUInt8(OP_RAW_D, 0);
  buf.writeUInt16LE(data.length, 1);
  data.copy(buf, 3);
  return buf;
}

// --- Fragment-specific encoders ---

function encodeStarsOrDust(svg) {
  const ellipses = parseEllipses(svg);
  const circles = parseCircles(svg);
  const ops = [];

  for (const e of ellipses) {
    // If rx ≈ ry (within 0.05), encode as CIRCLE to save 1 byte
    if (Math.abs(e.rx - e.ry) < 0.05) {
      ops.push(encodeCircleOp(e));
    } else {
      ops.push(encodeEllipseOp(e));
    }
  }

  for (const c of circles) {
    ops.push(encodeCircleOp({ cx: c.cx, cy: c.cy, rx: c.r }));
  }

  // Handle any <path> elements that aren't ellipses (rare in stars)
  const pathRe = /<path\s+d="([^"]+)"[^/]*\/>/g;
  let pm;
  while ((pm = pathRe.exec(svg)) !== null) {
    ops.push(encodeRawDOp(pm[1]));
  }

  return ops;
}

function encodeBodyTriangles(svg) {
  const ops = [];

  // Extract path data
  const pathRe = /<path\s+d="([^"]+)"[^/]*\/?>/g;
  let pm;
  while ((pm = pathRe.exec(svg)) !== null) {
    const pathData = pm[1];
    const triangles = parseTriangleMegaPath(pathData);

    if (triangles.length > 0) {
      for (const t of triangles) {
        ops.push(encodeTriangleOp(t));
      }
    } else {
      ops.push(encodeRawDOp(pathData));
    }
  }

  return ops;
}

function parsePolygonPoints(pointsStr) {
  const nums = parseNumbers(pointsStr);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push([nums[i], nums[i + 1]]);
  }
  return pts;
}

function hexFromPoints(pts) {
  if (!pts || pts.length < 6) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (!isFinite(x) || !isFinite(y)) return null;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  if (width <= 0) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const size = encodeRadius8(width / 2);
  return { cx, cy, size };
}

function encodeBodyHexagons(svg) {
  const ops = [];

  const polyRe = /<polygon\s+[^>]*points="([^"]+)"[^/]*\/>/g;
  let pmPoly;
  while ((pmPoly = polyRe.exec(svg)) !== null) {
    const pts = parsePolygonPoints(pmPoly[1]);
    const hex = hexFromPoints(pts);
    if (hex) {
      ops.push(encodeHexagonOp(hex));
    } else {
      ops.push(encodeRawPathOp(pmPoly[0]));
    }
  }

  const pathRe = /<path\s+d="([^"]+)"[^/]*\/?>/g;
  let pm;
  while ((pm = pathRe.exec(svg)) !== null) {
    const pathData = pm[1];
    const hexagons = parseHexagonPaths(pathData);

    if (hexagons.length > 0) {
      for (const h of hexagons) {
        ops.push(encodeHexagonOp(h));
      }
    } else {
      ops.push(encodeRawDOp(pathData));
    }
  }

  return ops;
}

function encodeComplexTriangles(svg) {
  // For spikesTriangles, teethTriangles, teethTriangles2
  // These contain mixed bezier+triangle content within single <path> elements.
  // We check if each path is PURELY triangles (all subpaths match m..h..z pattern).
  // If mixed, encode entire path as RAW_D to preserve fidelity.
  const ops = [];

  const pathRe = /<path\s+d="([^"]+)"[^/]*\/?>/g;
  let pm;
  while ((pm = pathRe.exec(svg)) !== null) {
    const pathData = pm[1];

    // Check if path is purely simple triangles (no c/C/q/Q/s/S/a/A commands)
    const hasCurves = /[cCqQsSaA]/.test(pathData);

    if (!hasCurves) {
      const triangles = parseTriangleMegaPath(pathData);
      if (triangles.length >= 1) {
        for (const t of triangles) {
          ops.push(encodeTriangleOp(t));
        }
        continue;
      }
    }

    // Mixed or complex path — encode as RAW_D
    ops.push(encodeRawDOp(pathData));
  }

  return ops;
}

// --- Main encoder ---

function encodeSvgToDsl(fragName, svg) {
  let ops;

  switch (fragName.toLowerCase()) {
    case "bgstars1":
    case "bgdust1":
      ops = encodeStarsOrDust(svg);
      break;
    case "bodyshapes1":
      ops = encodeBodyHexagons(svg);
      break;
    default:
      // Not eligible — encode entire SVG as RAW_PATH
      ops = [encodeRawPathOp(svg)];
  }

  // Build final binary: header + ops
  const header = Buffer.alloc(3);
  header.writeUInt8(DSL_VERSION, 0);
  header.writeUInt16LE(ops.length, 1);

  return Buffer.concat([header, ...ops]);
}

// --- CLI ---

function main() {
  const args = process.argv.slice(2);
  let inDir = "Fragments";
  let outDir = "Fragments/dsl";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--in" && args[i + 1]) inDir = args[++i];
    if (args[i] === "--out" && args[i + 1]) outDir = args[++i];
  }

  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(inDir).filter(f => f.endsWith(".frag.svg"));
  const stats = [];

  for (const file of files) {
    const fragName = file.replace(".frag.svg", "");
    if (!ELIGIBLE.has(fragName.toLowerCase())) continue;

    const svgPath = join(inDir, file);
    const svg = readFileSync(svgPath, "utf8");
    const rawBytes = Buffer.byteLength(svg, "utf8");

    const dsl = encodeSvgToDsl(fragName, svg);
    const dslPath = join(outDir, `${fragName}.dsl.bin`);
    writeFileSync(dslPath, dsl);

    const reduction = ((1 - dsl.length / rawBytes) * 100).toFixed(1);
    stats.push({
      fragment: fragName,
      rawBytes,
      dslBytes: dsl.length,
      reduction: `${reduction}%`,
      opcodes: dsl.readUInt16LE(1)
    });

    console.log(`${fragName}: ${rawBytes} → ${dsl.length} bytes (${reduction}% reduction, ${dsl.readUInt16LE(1)} opcodes)`);
  }

  // Write stats
  writeFileSync(
    join(outDir, "_dsl_stats.json"),
    JSON.stringify(stats, null, 2)
  );

  const totalRaw = stats.reduce((s, x) => s + x.rawBytes, 0);
  const totalDsl = stats.reduce((s, x) => s + x.dslBytes, 0);
  console.log(`\nTotal: ${totalRaw} → ${totalDsl} bytes (${((1 - totalDsl / totalRaw) * 100).toFixed(1)}% reduction)`);
}

main();
