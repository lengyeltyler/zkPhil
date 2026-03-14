# Architecture

## Overview

zkPhil keeps the old Phil product surface and swaps in the new `zkPhilLayers` art backend.

The live Sepolia stack is:

1. `PhilSVGStorage` for raw on-chain SVG bytes
2. `PhilLayerRegistry` for ordered layer, asset, and variant metadata
3. `PhilNFT` for direct art-backend minting
4. `PhilRenderer`, `ProofGateTest13`, `PhilTestMint`, `PhilWeb3`, and `PhilMarketplace` for the legacy mint / preview / marketplace flow
5. `PhilAccount`, `PhilAccountFactory`, `PhilUnlockInbox`, and `PhilPaymaster` still present in the repo for the future 4337 rollout

## Live Sepolia state

### Art backend

- `PhilSVGStorage`: `0x77C1A28296d39fb91F7575e85A4493E5036B8A4c`
- `PhilLayerRegistry`: `0x43d8367eC689548325775DC0606F92d7193D4863`
- `PhilNFT`: `0x0B0d8dE5C1d3ea3840C0951E9edcd4EA6F7d5585`

### Legacy stack

- `PhilRenderer`: `0x340723044338A3380139d27b9d7A6A9c74e3dd3C`
- `ProofGateTest13`: `0x4382fe0B5eC60693B31999899Fec6D97F36fdB86`
- `PhilTestMint`: `0xB3Be564d41Dee62774084BBEF2e9c33c507728f1`
- `PhilWeb3`: `0x2EA2E745047a127467A1e926380436395f394f8c`
- `PhilMarketplace`: `0xF005d21711A6C4e4C36C6aa83604A6AD99Bb4D06`

### 4337 status

The repo still contains the full 4337 layer, but live Sepolia deployment is intentionally pending until these are available:

- `STARKNET_CORE`
- `L2_UNLOCK_VERIFIER`
- `ALLOWLIST_SIGNER_KEY`
- `PAYMASTER_SIGNER_KEY`

## Render flow

1. `zkPhilLayers/` is cataloged into ordered layer metadata.
2. Each SVG is stored raw in `PhilSVGStorage`, with chunking above `24,576` bytes.
3. `PhilLayerRegistry` stores the 13-layer stack, asset records, and variant records.
4. `PhilRenderer` preserves the old render API but now pulls its selections from the registry and SVG storage contracts.
5. `PhilTestMint` keeps the old proof-gated mint surface and delegates image composition to `PhilRenderer`.

The final composite still renders from bottom to top:

- `BgColor` first
- `BodyBase` underneath `Body`
- `Top` last

## BodyBase compatibility

`BodyBase` now occupies the slot that used to be an empty placeholder under `Body`.

Current behavior:

- source folder: `zkPhilLayers/BodyBase/`
- file pattern: `Body<Color>.svg`
- registered layer name: `BodyBase`
- selection rule: exactly `1`
- color logic: independent random roll with a deterministic bias that makes same-color matches against `Body` uncommon

## Deployment flows

### Art backend

The active Sepolia art pipeline is:

- `scripts/build-layer-catalog.mjs`
- `scripts/upload-svgs.mjs`
- `scripts/deploy-sepolia.mjs`

Outputs:

- `deployments/sepolia-addresses.json`
- `upload-manifest.json`
- `generated/layer-catalog.json`
- `generated/registry-manifest.json`

The SVG storage contract was reused in this pass, and the refreshed registry/NFT were deployed on top of it.

### Legacy stack

The legacy deploy flow stays:

```bash
node scripts/deploy_stark.mjs
node scripts/deploy_marketplace.mjs
```

Those scripts now read the active art backend from `deployments/sepolia-addresses.json` unless explicit overrides are supplied.

### Future 4337 deploy

Once Starknet bindings are available:

```bash
node scripts/deploy_4337.mjs
npm run verify:sepolia
```

## Frontend

The Vite preview app in `frontend-local/` reads:

- `deployments/sepolia-addresses.json`
- `deployments/stark_11155111.json`
- `deployments/marketplace_11155111.json`

That keeps the preview frontend aligned with the latest Sepolia deployment without hardcoded contract addresses.
