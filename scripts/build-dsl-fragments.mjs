#!/usr/bin/env node
/**
 * build-dsl-fragments.mjs — Full build pipeline for DSL fragments.
 *
 * 1. Runs svg-to-dsl.mjs to encode eligible SVG fragments into binary DSL
 * 2. Runs dsl-to-svg.mjs to decode them back for verification
 * 3. Reports compression statistics
 * 4. Generates a deployment config JSON showing which fragment indices are DSL-encoded
 *
 * Usage:
 *   node scripts/build-dsl-fragments.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const FRAG_DIR = "Fragments";
const DSL_DIR = "Fragments/dsl";
const DECODED_DIR = "Fragments/dsl-decoded";

function listFragmentNames() {
  if (!existsSync(FRAG_DIR)) return [];
  return readdirSync(FRAG_DIR)
    .filter((f) => f.endsWith(".frag.svg"))
    .map((f) => f.replace(".frag.svg", ""))
    .sort((a, b) => a.localeCompare(b));
}

// Which fragments get DSL encoding (case-insensitive)
const DSL_ELIGIBLE = new Set([
  "bgstars1",
  "bgdust1",
  "bodyshapes1",
]);

function main() {
  console.log("=== Phil DSL Fragment Build ===\n");

  // Step 1: Encode
  console.log("Step 1: Encoding SVG → DSL...");
  execSync("node scripts/svg-to-dsl.mjs", { stdio: "inherit" });
  console.log();

  // Step 2: Decode for verification
  console.log("Step 2: Decoding DSL → SVG for verification...");
  execSync("node scripts/dsl-to-svg.mjs", { stdio: "inherit" });
  console.log();

  // Step 3: Generate DSL flags for deployment
  console.log("Step 3: Generating deployment config...");

  const fragmentNames = listFragmentNames();
  const dslFlags = new Array(fragmentNames.length).fill(false);

  for (let i = 0; i < fragmentNames.length; i++) {
    const name = fragmentNames[i];
    if (name && DSL_ELIGIBLE.has(name.toLowerCase())) {
      dslFlags[i] = true;
    }
  }

  const config = {
    dslFlags,
    fragments: fragmentNames.map((name, index) => ({
      index,
      name,
      dsl: dslFlags[index],
      dslFile: `${DSL_DIR}/${name}.dsl.bin`,
      fragFile: `${FRAG_DIR}/${name}.frag.svg`,
    })),
  };

  writeFileSync(
    join(DSL_DIR, "_deploy_config.json"),
    JSON.stringify(config, null, 2)
  );

  console.log("\nDSL flags for PhilFragments constructor:");
  console.log(`  [${dslFlags.map(b => b ? "true" : "false").join(", ")}]`);

  console.log("\nDSL-encoded fragments:");
  for (const f of config.fragments.filter((x) => x.dsl)) {
    if (existsSync(f.dslFile)) {
      const dslSize = readFileSync(f.dslFile).length;
      const rawSize = existsSync(f.fragFile) ? readFileSync(f.fragFile).length : "?";
      console.log(`  [${f.index}] ${f.name}: ${rawSize} → ${dslSize} bytes`);
    }
  }

  console.log("\nRaw SVG fragments (no DSL):");
  for (const f of config.fragments.filter((x) => !x.dsl)) {
    if (existsSync(f.fragFile)) {
      console.log(`  [${f.index}] ${f.name}: ${readFileSync(f.fragFile).length} bytes`);
    }
  }

  console.log("\n=== Build complete ===");
}

main();
