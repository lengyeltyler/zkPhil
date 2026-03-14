# zkPhil

zkPhil is the open-source Sepolia testnet release of Phil: the legacy proof-gated mint, on-chain renderer, ERC-4804 endpoint, backend signer flow, and CryptoPunks-style marketplace wired to the new `zkPhilLayers` art backend.

Code and smart contracts in this repo are licensed under [MIT](./LICENSE). SVG artwork in [`zkPhilLayers/`](./zkPhilLayers) is released under [CC0 1.0](./LICENSE-ARTWORK).

## Live Sepolia deployment

### Art backend

- `PhilSVGStorage`: `0x77C1A28296d39fb91F7575e85A4493E5036B8A4c`
- `PhilLayerRegistry`: `0x43d8367eC689548325775DC0606F92d7193D4863`
- `PhilNFT`: `0x0B0d8dE5C1d3ea3840C0951E9edcd4EA6F7d5585`

### Legacy stack on top of the art backend

- `PhilRenderer`: `0x340723044338A3380139d27b9d7A6A9c74e3dd3C`
- `ProofGateTest13`: `0x4382fe0B5eC60693B31999899Fec6D97F36fdB86`
- `PhilTestMint`: `0xB3Be564d41Dee62774084BBEF2e9c33c507728f1`
- `PhilWeb3`: `0x2EA2E745047a127467A1e926380436395f394f8c`
- `PhilMarketplace`: `0xF005d21711A6C4e4C36C6aa83604A6AD99Bb4D06`

Deployment manifests:

- [`deployments/sepolia-addresses.json`](./deployments/sepolia-addresses.json)
- [`deployments/stark_11155111.json`](./deployments/stark_11155111.json)
- [`deployments/marketplace_11155111.json`](./deployments/marketplace_11155111.json)
- [`DEPLOYMENT_LOG.md`](./DEPLOYMENT_LOG.md)

## What is live now

- The new `zkPhilLayers` art pipeline is stored fully on-chain with raw SVG uploads and chunking for files over `24,576` bytes.
- `BodyBase` is now part of the registered Sepolia layer stack and renders underneath `Body`.
- `BodyBase` is rolled independently from `Body`, with same-color outcomes intentionally uncommon.
- The legacy renderer/mint/marketplace stack has been redeployed against the refreshed art backend.
- This is a Sepolia testnet release. Mainnet is still forthcoming.

## 4337 roadmap

The ERC-4337 / Starknet unlock path is still in this repo, but it was not deployed in this Sepolia pass.

To finish the live 4337 rollout later, the deployer will need:

- `STARKNET_CORE`
- `L2_UNLOCK_VERIFIER`
- `ALLOWLIST_SIGNER_KEY`
- `PAYMASTER_SIGNER_KEY`
- optional `PAYMASTER_DEPOSIT`

Once those are set, the next step is:

```bash
node scripts/deploy_4337.mjs
npm run verify:sepolia
```

## Docs

- Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Layer structure: [`docs/LAYERS.md`](./docs/LAYERS.md)
- Sepolia audit / release notes: [`docs/AUDIT_SEPOLIA.md`](./docs/AUDIT_SEPOLIA.md)

## Setup

```bash
npm install
cd server-ts && npm install && cd ..
cp .env.example .env
```

Required env vars for the live Sepolia stack:

- `RPC_URL_SEPOLIA`
- `RPC_URL`
- `CHAIN_ID=11155111`
- `PRIVATE_KEY`
- `PROGRAM_HASH`
- `DROP_ID`
- `ALLOWLIST_SIGNER`
- `ALLOWLIST_SIGNER_KEY`
- `PAYMASTER_SIGNER_KEY`

## Common commands

```bash
npm run compile
npm test
npm run frontend:build
npm run frontend:dev
```

### Sepolia deploy commands

```bash
node scripts/deploy_stark.mjs
node scripts/deploy_marketplace.mjs
```

### Frontend preview

The Vite preview app reads the active Sepolia manifests at build time, so after a fresh deploy it will automatically point at the current `PhilRenderer`, `PhilTestMint`, `PhilWeb3`, `PhilLayerRegistry`, and `PhilSVGStorage`.
