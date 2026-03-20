// scripts/strip_optimize_svgs.mjs
// Phil fragment pipeline: strip <svg>, SVGO optimize, optionally:
//  - dedup "triangle soup" paths into <defs>/<use> BEFORE svgo (big win when triangles are one mega path)
//  - convert bgStars mega-path "dot blobs" into <circle> elements BEFORE svgo (usually huge win)
//
// Usage:
//   node scripts/strip_optimize_svgs.mjs --in ./Layers --out ./Fragments --mode outlines \
//     --dedupTriangles true --starsToCircles true
//
// Modes:
//   outlines = remove style attrs so renderer applies palette via wrapper <g ...>
//   keep     = keep attrs (still strips wrapper), still SVGO
//
// Notes:
// - This script is intentionally conservative: if a transform doesn't clearly apply, it leaves the fragment unchanged.
// - It writes Fragments/_fragment_sizes.json sorted by outBytes desc.

import fs from "node:fs";
import path from "node:path";
import { optimize } from "svgo";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}
function asBool(v, def = false) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return def;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function listSvgFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listSvgFiles(full));
    else if (ent.isFile() && ent.name.toLowerCase().endsWith(".svg")) out.push(full);
  }
  return out;
}
function bytes(s) {
  return Buffer.byteLength(s, "utf8");
}
function fmt(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Strips outer <svg ...> ... </svg> wrapper; returns inner content.
function stripToInnerFragment(svg) {
  svg = svg.replace(/^\uFEFF/, "");
  svg = svg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  if (!/<svg\b/i.test(svg)) return svg.trim();

  const openMatch = svg.match(/<svg\b[^>]*>/i);
  if (!openMatch) return svg.trim();
  const openTag = openMatch[0];
  const start = svg.indexOf(openTag) + openTag.length;
  const end = svg.toLowerCase().lastIndexOf("</svg>");
  if (end <= start) return svg.trim();
  return svg.slice(start, end).trim();
}
function wrapAsSvgForSvgo(fragment) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 420 420">${fragment}</svg>`;
}
function unwrapAfterSvgo(svgDoc) {
  return stripToInnerFragment(svgDoc);
}

function makeSvgoConfig(mode, floatPrecision = 2, opts = {}) {
  const preserveStyles = opts.preserveStyles === true;
  const removeStyleAttrs = mode === "outlines" && !preserveStyles;
  const preserveShapes = opts.preserveShapes === true;
  return {
    multipass: true,
    js2svg: { pretty: false, indent: 0 },
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            cleanupIds: true,
            // Very important: aggressive precision helps a lot on Illustrator exports.
            convertPathData: {
              floatPrecision,
              transformPrecision: floatPrecision,
              leadingZero: true,
              negativeExtraSpace: false,
              noSpaceAfterFlags: true,
            },
            cleanupNumericValues: { floatPrecision, leadingZero: true },
            mergePaths: true,
            collapseGroups: true,
            convertShapeToPath: !preserveShapes,
          },
        },
      },
      "removeDoctype",
      "removeXMLProcInst",
      "removeComments",
      "removeMetadata",
      "removeTitle",
      "removeDesc",
      "removeUselessDefs",
      "removeEmptyText",
      "removeEditorsNSData",
      "removeUnusedNS",
      "cleanupEnableBackground",
      "removeHiddenElems",
      "removeEmptyAttrs",
      "removeEmptyContainers",
      "removeUselessStrokeAndFill",
      "cleanupAttrs",
      "sortAttrs",
      "sortDefsChildren",
      { name: "removeDimensions", active: true },
      { name: "removeViewBox", active: false },

      ...(removeStyleAttrs
        ? [
            {
              name: "removeAttrs",
              params: {
                attrs: [
                  "fill",
                  "fill-rule",
                  "stroke",
                  "stroke-width",
                  "stroke-linecap",
                  "stroke-linejoin",
                  "stroke-miterlimit",
                  "opacity",
                  "style",
                  "class",
                  "id",
                  "data-name",
                ],
              },
            },
          ]
        : []),
    ],
  };
}

function isDslCandidate(baseName) {
  const name = baseName.toLowerCase();
  return name === "bgstars1" || name === "bgdust1" || name === "bodyshapes1";
}

/* -------------------------------------------------------------------------- */
/* Triangle soup -> <defs>/<use> (BEFORE SVGO)                                */
/* -------------------------------------------------------------------------- */

function dedupTrianglesFragment(fragment, { idPrefix = "t" } = {}) {
  // Only handle a SINGLE <path ... d="..."> that contains many subpaths
  const m = fragment.match(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/i);
  if (!m) return { changed: false, out: fragment, reason: "no <path d=...>" };
  const d = m[1];

  // Bail if unsupported commands present
  if (/[CcSsQqTtAa]/.test(d)) {
    return { changed: false, out: fragment, reason: "unsupported commands in d" };
  }

  const tokens = tokenizePath(d);
  if (!tokens.length) return { changed: false, out: fragment, reason: "tokenize failed" };

  const subpaths = splitIntoSubpaths(tokens);
  if (!subpaths.length) return { changed: false, out: fragment, reason: "no subpaths" };

  const triangles = [];
  let cx = 0,
    cy = 0,
    sx = 0,
    sy = 0;

  for (const sp of subpaths) {
    const res = subpathToPoints(sp, { cx, cy, sx, sy });
    cx = res.cx;
    cy = res.cy;
    sx = res.sx;
    sy = res.sy;

    if (!res.isClosed) continue;
    if (!res.isSimple) continue;
    if (res.points.length !== 3) continue;

    triangles.push({
      points: res.points, // abs points
      anchor: res.anchor, // first point abs
    });
  }

  if (triangles.length < 10) {
    return { changed: false, out: fragment, reason: `only ${triangles.length} triangles` };
  }

  const round = (n) => +n.toFixed(2);
  const shapeMap = new Map(); // key -> { id, pathD }
  const uses = [];

  for (const tri of triangles) {
    const a = tri.anchor;
    const norm = tri.points.map(([x, y]) => [round(x - a[0]), round(y - a[1])]);
    const key = norm.map(([x, y]) => `${x},${y}`).join("|");

    let entry = shapeMap.get(key);
    if (!entry) {
      const id = `${idPrefix}${shapeMap.size}`;
      const pathD = pointsToPathD(norm);
      entry = { id, pathD };
      shapeMap.set(key, entry);
    }
    uses.push({ href: `#${entry.id}`, tx: round(a[0]), ty: round(a[1]) });
  }

  // If almost everything is unique, defs/use won't help
  if (shapeMap.size > triangles.length * 0.9) {
    return { changed: false, out: fragment, reason: "too few duplicates" };
  }

  let defs = "<defs>";
  for (const entry of shapeMap.values()) {
    defs += `<path id="${entry.id}" d="${entry.pathD}"/>`;
  }
  defs += "</defs>";

  let useStr = "";
  for (const u of uses) {
    useStr += `<use href="${u.href}" transform="translate(${u.tx} ${u.ty})"/>`;
  }

  const replaced = fragment.replace(m[0], `${defs}${useStr}`);
  return { changed: true, out: replaced, reason: `triangles:${triangles.length} uniques:${shapeMap.size}` };
}

function tokenizePath(d) {
  const re = /([MmLlHhVvZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g;
  const out = [];
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push({ t: "cmd", v: m[1] });
    else out.push({ t: "num", v: Number(m[2]) });
  }
  return out;
}
function splitIntoSubpaths(tokens) {
  const subs = [];
  let cur = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === "cmd" && (tok.v === "M" || tok.v === "m") && cur.length) {
      subs.push(cur);
      cur = [tok];
    } else cur.push(tok);
  }
  if (cur.length) subs.push(cur);
  return subs;
}
function subpathToPoints(tokens, state) {
  let { cx, cy, sx, sy } = state;
  let isClosed = false;
  let isSimple = true;

  const first = tokens[0];
  if (!first || first.t !== "cmd" || (first.v !== "M" && first.v !== "m")) {
    return { cx, cy, sx, sy, isClosed: false, isSimple: false, points: [], anchor: [0, 0] };
  }

  let i = 1;
  const mx = tokens[i++]?.v;
  const my = tokens[i++]?.v;
  if (mx == null || my == null) {
    return { cx, cy, sx, sy, isClosed: false, isSimple: false, points: [], anchor: [0, 0] };
  }

  if (first.v === "m") {
    cx += mx;
    cy += my;
  } else {
    cx = mx;
    cy = my;
  }
  sx = cx;
  sy = cy;

  const pts = [[cx, cy]];
  const anchor = [cx, cy];

  while (i < tokens.length) {
    const tok = tokens[i++];
    if (!tok || tok.t !== "cmd") {
      isSimple = false;
      break;
    }
    const cmd = tok.v;

    if (cmd === "z" || cmd === "Z") {
      isClosed = true;
      cx = sx;
      cy = sy;
      continue;
    }

    if (cmd === "L" || cmd === "l") {
      const x = tokens[i++]?.v,
        y = tokens[i++]?.v;
      if (x == null || y == null) {
        isSimple = false;
        break;
      }
      if (cmd === "l") {
        cx += x;
        cy += y;
      } else {
        cx = x;
        cy = y;
      }
      pts.push([cx, cy]);
      continue;
    }

    if (cmd === "H" || cmd === "h") {
      const x = tokens[i++]?.v;
      if (x == null) {
        isSimple = false;
        break;
      }
      if (cmd === "h") cx += x;
      else cx = x;
      pts.push([cx, cy]);
      continue;
    }

    if (cmd === "V" || cmd === "v") {
      const y = tokens[i++]?.v;
      if (y == null) {
        isSimple = false;
        break;
      }
      if (cmd === "v") cy += y;
      else cy = y;
      pts.push([cx, cy]);
      continue;
    }

    isSimple = false;
    break;
  }

  // Dedup adjacent identical points
  const uniq = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) uniq.push(p);
  }

  // Remove trailing repeat of first if present
  let corners = uniq;
  if (corners.length === 4 && corners[0][0] === corners[3][0] && corners[0][1] === corners[3][1]) {
    corners = corners.slice(0, 3);
  }

  if (corners.length !== 3) return { cx, cy, sx, sy, isClosed, isSimple, points: [], anchor };
  return { cx, cy, sx, sy, isClosed, isSimple, points: corners, anchor };
}

function pointsToPathD(normPoints) {
  const [p0, p1, p2] = normPoints;
  return `M${p0[0]} ${p0[1]}L${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}Z`;
}

/* -------------------------------------------------------------------------- */
/* bgStars mega-path -> <circle>... (BEFORE SVGO)                              */
/* -------------------------------------------------------------------------- */

function starsPathToCircles(fragment) {
  const m = fragment.match(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/i);
  if (!m) return { changed: false, out: fragment, reason: "no single path" };

  const d = m[1].replace(/\s+/g, " ").trim();

  // Many stars are encoded as repeated absolute M subpaths.
  const parts = d.split(/(?=M)/g).filter(Boolean);
  if (parts.length < 20) return { changed: false, out: fragment, reason: "too few M parts" };

  const circles = [];
  for (const p of parts) {
    // Match start: M cx cy c r 0 ...
    const mm = p.match(/^M\s*(-?\d*\.?\d+)\s*(-?\d*\.?\d+)\s*c\s*(-?\d*\.?\d+)\s*0/i);
    if (!mm) continue;
    const cx = Number(mm[1]);
    const cy = Number(mm[2]);
    const r = Math.abs(Number(mm[3]));
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(r) || r <= 0) continue;

    circles.push({ cx: +cx.toFixed(2), cy: +cy.toFixed(2), r: +r.toFixed(2) });
  }

  if (circles.length < 20) {
    return { changed: false, out: fragment, reason: `only ${circles.length} circles parsed` };
  }

  const out = circles.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`).join("");
  return { changed: true, out, reason: `circles:${circles.length}` };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const args = parseArgs(process.argv);
  const inDir = args.in ?? "./Layers";
  const outDir = args.out ?? "./Fragments";
  const mode = String(args.mode ?? "outlines").toLowerCase();
  const maxBytes = Number(args.maxBytes ?? 49152);
  const precisionSteps = [2, 1, 0];

  const dedupTriangles = asBool(args.dedupTriangles, false);
  const starsToCircles = asBool(args.starsToCircles, false);

  if (!["outlines", "keep"].includes(mode)) {
    console.error(`Unknown --mode ${mode}. Use "outlines" or "keep".`);
    process.exit(1);
  }
  if (!fs.existsSync(inDir)) {
    console.error(`Input folder not found: ${inDir}`);
    process.exit(1);
  }

  ensureDir(outDir);
  const files = listSvgFiles(inDir);
  if (!files.length) {
    console.error(`No .svg files found under ${inDir}`);
    process.exit(1);
  }

  const report = [];
  for (const file of files) {
    const rel = path.relative(inDir, file);
    const base = path.basename(file, ".svg");

    const raw = fs.readFileSync(file, "utf8");
    const rawBytes = bytes(raw);

    // 1) strip wrapper
    let fragmentPre = stripToInnerFragment(raw);

    // 2) PRE-SVGO transforms (this is the important change)
    if (dedupTriangles && /triangles/i.test(base)) {
      const dd0 = dedupTrianglesFragment(fragmentPre, { idPrefix: `${base}_t` });
      if (dd0.changed) fragmentPre = dd0.out;
    }

    if (starsToCircles && /bgStars/i.test(base)) {
      const sc = starsPathToCircles(fragmentPre);
      if (sc.changed) fragmentPre = sc.out;
    }

    // 3) SVGO optimize (wrap temporarily)
    const wrapped = wrapAsSvgForSvgo(fragmentPre);
    let fragment = "";
    let usedPrecision = precisionSteps[0];
    const preserveShapes = isDslCandidate(base);
    const preserveStyles = /bgnebula/i.test(base);
    for (const precision of precisionSteps) {
      const svgoConfig = makeSvgoConfig(mode, precision, { preserveShapes, preserveStyles });
      const optimized = optimize(wrapped, { path: file, ...svgoConfig });
      if (optimized.error) {
        console.warn(`SVGO error for ${rel}: ${optimized.error}`);
        fragment = "";
        break;
      }
      fragment = unwrapAfterSvgo(optimized.data)
        .replace(/<svg\b[^>]*>/gi, "")
        .replace(/<\/svg>/gi, "")
        .trim();
      const outBytesTmp = bytes(fragment);
      usedPrecision = precision;
      if (outBytesTmp <= maxBytes) break;
    }

    if (!fragment) continue;

    const outPath = path.join(outDir, `${base}.frag.svg`);
    fs.writeFileSync(outPath, fragment, "utf8");

    const outBytes = bytes(fragment);
    if (outBytes > maxBytes) {
      console.warn(
        `WARNING: ${rel} output is ${outBytes} bytes (>${maxBytes}) after precision ${usedPrecision}`
      );
    }
    report.push({ rel, rawBytes, outBytes, outPath, precision: usedPrecision });
  }

  report.sort((a, b) => b.outBytes - a.outBytes);

  console.log(`\nOptimized fragments written to: ${outDir}`);
  console.log(`Mode: ${mode}`);
  console.log(`Triangle dedup: ${dedupTriangles}`);
  console.log(`Stars→Circles: ${starsToCircles}\n`);
  console.log(`Max bytes: ${maxBytes}\n`);

  console.log(`Largest outputs (top 10):`);
  for (const r of report.slice(0, 10)) {
    const savings = r.rawBytes ? 100 * (1 - r.outBytes / r.rawBytes) : 0;
    console.log(
      `- ${r.rel.padEnd(24)}  ${fmt(r.rawBytes).padStart(9)} → ${fmt(r.outBytes).padStart(9)}  (${savings.toFixed(
        1
      )}% smaller)`
    );
  }

  const summaryPath = path.join(outDir, "_fragment_sizes.json");
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWrote size summary: ${summaryPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
