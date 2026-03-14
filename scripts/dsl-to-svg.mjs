#!/usr/bin/env node
/**
 * dsl-to-svg.mjs — Decodes DSL binary files back to SVG fragments.
 * Used for testing/validation: SVG → DSL → SVG round-trip comparison.
 *
 * Usage:
 *   node scripts/dsl-to-svg.mjs --in Fragments/dsl --out Fragments/dsl-decoded
 *   node scripts/dsl-to-svg.mjs --file Fragments/dsl/bgStars.dsl.bin
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

// Opcode constants (must match svg-to-dsl.mjs)
const OP_ELLIPSE  = 0x01;
const OP_TRIANGLE = 0x02;
const OP_HEXAGON  = 0x03;
const OP_RECT     = 0x04;
const OP_CIRCLE   = 0x05;
const OP_RAW_PATH = 0x08;
const OP_RAW_D    = 0x09;

function decodeCoord(val) {
  return (val / 100).toFixed(2).replace(/\.?0+$/, "");
}

function decodeRadius8(val) {
  return (val / 10).toFixed(1).replace(/\.?0+$/, "");
}

function decodeSignedCoord(val) {
  // val is int16, represents x100 fixed point
  const f = val / 100;
  return f.toFixed(2).replace(/\.?0+$/, "");
}

function decodeDsl(buf) {
  const version = buf.readUInt8(0);
  const opCount = buf.readUInt16LE(1);
  let pos = 3;
  const parts = [];

  for (let i = 0; i < opCount && pos < buf.length; i++) {
    const op = buf.readUInt8(pos);
    pos++;

    switch (op) {
      case OP_ELLIPSE: {
        const cx = decodeCoord(buf.readUInt16LE(pos));     pos += 2;
        const cy = decodeCoord(buf.readUInt16LE(pos));     pos += 2;
        const rx = decodeRadius8(buf.readUInt8(pos));      pos += 1;
        const ry = decodeRadius8(buf.readUInt8(pos));      pos += 1;
        parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`);
        break;
      }

      case OP_CIRCLE: {
        const cx = decodeCoord(buf.readUInt16LE(pos));     pos += 2;
        const cy = decodeCoord(buf.readUInt16LE(pos));     pos += 2;
        const r = decodeRadius8(buf.readUInt8(pos));       pos += 1;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}"/>`);
        break;
      }

      case OP_TRIANGLE: {
        const x = decodeCoord(buf.readUInt16LE(pos));      pos += 2;
        const y = decodeCoord(buf.readUInt16LE(pos));      pos += 2;
        const dx1 = decodeSignedCoord(buf.readInt16LE(pos)); pos += 2;
        const dy1 = decodeSignedCoord(buf.readInt16LE(pos)); pos += 2;
        const dx2 = decodeSignedCoord(buf.readInt16LE(pos)); pos += 2;
        // Emit as individual triangle path: M x y l dx1 dy1 h dx2 Z
        parts.push(`<path d="M${x} ${y}l${dx1} ${dy1}h${dx2}Z"/>`);
        break;
      }

      case OP_HEXAGON: {
        const cx = decodeCoord(buf.readUInt16LE(pos));     pos += 2;
        const cy = decodeCoord(buf.readUInt16LE(pos));     pos += 2;
        const sizeRaw = buf.readUInt8(pos);                pos += 1;
        const s = sizeRaw / 10; // half-width
        // Regular hexagon centered at cx,cy with half-width s
        // Points: top-left, top-right (flat top), then down
        const h = s * Math.sqrt(3); // height = s * sqrt(3) for flat-top hex
        const hx = parseFloat(cx);
        const hy = parseFloat(cy);
        // Flat-top hexagon vertices (from top-left going clockwise):
        // The bodyHexagons format starts at left vertex and uses:
        // m<x> <y>-s1 -s2 s1 -s2 h<2s> l<s1> <s2> -<s1> <s2> z
        // We'll emit the same pattern
        const s1 = (s / 2).toFixed(2).replace(/\.?0+$/, "");
        const s2 = (s * 0.866).toFixed(2).replace(/\.?0+$/, ""); // sin(60) * s
        const w = (s * 2).toFixed(2).replace(/\.?0+$/, "");
        parts.push(`<path d="M${(hx - s).toFixed(2).replace(/\.?0+$/, "")} ${cy}l${s1} -${s2}h${w}l${s1} ${s2}-${s1} ${s2}h-${w}Z"/>`);
        break;
      }

      case OP_RECT: {
        const x = decodeCoord(buf.readUInt16LE(pos));      pos += 2;
        const y = decodeCoord(buf.readUInt16LE(pos));      pos += 2;
        const w = decodeCoord(buf.readUInt16LE(pos));      pos += 2;
        const h = decodeCoord(buf.readUInt16LE(pos));      pos += 2;
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`);
        break;
      }

      case OP_RAW_PATH: {
        const len = buf.readUInt16LE(pos);                 pos += 2;
        const data = buf.slice(pos, pos + len).toString("utf8");
        pos += len;
        parts.push(data);
        break;
      }

      case OP_RAW_D: {
        const len = buf.readUInt16LE(pos);                 pos += 2;
        const data = buf.slice(pos, pos + len).toString("utf8");
        pos += len;
        parts.push(`<path d="${data}"/>`);
        break;
      }

      default:
        console.error(`Unknown opcode 0x${op.toString(16)} at pos ${pos - 1}`);
        return parts.join("");
    }
  }

  return parts.join("");
}

function main() {
  const args = process.argv.slice(2);
  let inDir = "Fragments/dsl";
  let outDir = "Fragments/dsl-decoded";
  let singleFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--in" && args[i + 1]) inDir = args[++i];
    if (args[i] === "--out" && args[i + 1]) outDir = args[++i];
    if (args[i] === "--file" && args[i + 1]) singleFile = args[++i];
  }

  if (singleFile) {
    const buf = readFileSync(singleFile);
    const svg = decodeDsl(buf);
    console.log(svg);
    return;
  }

  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(inDir).filter(f => f.endsWith(".dsl.bin"));

  for (const file of files) {
    const buf = readFileSync(join(inDir, file));
    const svg = decodeDsl(buf);
    const outName = file.replace(".dsl.bin", ".decoded.svg");
    writeFileSync(join(outDir, outName), svg);
    console.log(`${file} → ${outName} (${svg.length} bytes)`);
  }
}

main();
