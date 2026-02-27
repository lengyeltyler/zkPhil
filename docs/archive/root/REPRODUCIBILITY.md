# Reproducibility Guide

This document describes how to fully rebuild, verify, and deploy philFresh locally from scratch — with no external service dependencies.

## Prerequisites

- Node.js >= 18.20.0
- npm >= 9.x

No other global dependencies are required. Solidity compilation happens via Hardhat in `node_modules`.

## Setup

```sh
# Clone or copy the repo
cd phil_replica_audit

# Install pinned dependencies (uses package-lock.json exactly)
npm ci

# Copy and configure environment
cp .env.example .env
# Edit .env:
#   RPC_URL=http://127.0.0.1:8545   (for local dev)
#   PRIVATE_KEY=<your throwaway dev key>
#   PROGRAM_HASH, DROP_ID, etc. as needed
```

## Running Tests (no network required)

```sh
# Fast tests: DSL, SVG render, palette, equivalence snapshots
npm run test:svg
npm run test:palette
npm run test:equivalence

# Contract integration tests (uses ganache in-process, no external node)
npm run test:proof
npm run test:errors

# Full suite
npm test
```

## Building Fragment Manifest

The fragment manifest records the binary payloads that will be deployed on-chain.

```sh
# Reads Layers/ SVG files, encodes to DSL v2, writes artifacts/fragments/build-manifest.json
npm run fragments:build
```

The manifest includes a `goldenChecks` field verifying that the rendered output
matches the canonical SVGs at ≥93% token coverage.

**Important:** Do not modify `Layers/Phil*.svg` files or `shared/phil-renderer/phil-palettes-v2.json`
after generating the manifest. These files determine the on-chain content.

## Verifying Fragment Build Determinism

To verify that the build is reproducible:

```sh
npm run fragments:build
cp artifacts/fragments/build-manifest.json /tmp/manifest-a.json

npm run fragments:build
cp artifacts/fragments/build-manifest.json /tmp/manifest-b.json

# Compare (ignoring generatedAt timestamp field)
node -e "
const a = JSON.parse(require('fs').readFileSync('/tmp/manifest-a.json','utf8'));
const b = JSON.parse(require('fs').readFileSync('/tmp/manifest-b.json','utf8'));
delete a.generatedAt; delete b.generatedAt;
const match = JSON.stringify(a) === JSON.stringify(b);
console.log(match ? 'REPRODUCIBLE' : 'MISMATCH');
"
```

## Local Deployment

```sh
# Terminal 1: Start local Hardhat node
npm run node

# Terminal 2: Deploy contracts
npm run deploy:local

# Verify deployment
npm run local:e2e
```

## Equivalence Snapshot Verification

The golden snapshots in `test/snapshots/golden.json` record expected outputs
for fixed test vectors. They are compared against in `test/equivalence-snapshots.test.mjs`.

To verify that the replica produces the same outputs as the original:

```sh
npm run test:equivalence
```

All 6 snapshot checks must pass. If any fail, it indicates a change in:
- SVG rendering logic
- Mixing/PRNG logic
- Palette encoding
- Merkle tree construction
- Proof hash computation

Any such failure must be investigated before deployment.

## On-Chain Verification

After deployment, anyone can verify the on-chain SVG by:

1. Reading `PhilFragments.chunkPtr(i)` for all chunk indices (0..N-1).
2. Reading `SSTORE2.read(ptr)` for each chunk pointer.
3. Assembling fragment bytes using the offset table from `PhilFragments.offsets()`.
4. Decoding DSL-encoded fragments using the DSL v2 spec in `PhilDSLDecoder.sol`.
5. Reading palette bytes from `PhilPalettes.paletteData(philId)`.
6. Applying palette substitution per `PhilRenderer._applyPalette()` logic.
7. Comparing the reconstructed SVG to `renderPhil(philId, paletteVariant, mixSeed, mixMode)`.

This is fully on-chain and requires no external services.

## Self-Hosted RPC

For production deployment, use a self-hosted or local Ethereum node:
- Hardhat node: `npm run node`
- Anvil (Foundry): `anvil --chain-id 31337`
- Geth/Erigon: any full node with RPC enabled

Set `RPC_URL=http://127.0.0.1:8545` (or your node's RPC URL) in `.env`.

Do not use shared API provider keys (Infura, Alchemy, etc.) in production or
commit them to `.env`.
