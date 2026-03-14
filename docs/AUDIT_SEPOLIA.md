# AUDIT_SEPOLIA

## Release summary

This Sepolia release is ready for public feedback on the non-4337 path.

Live in this pass:

- refreshed `zkPhilLayers` art backend
- `BodyBase` added to the active layer stack
- legacy renderer + proof-gated mint flow redeployed against the updated backend
- marketplace redeployed against the refreshed mint contract
- frontend preview updated to read live manifests instead of stale hardcoded addresses

Not deployed in this pass:

- `PhilAccount`
- `PhilAccountFactory`
- `PhilUnlockInbox`
- `PhilPaymaster`

Those contracts remain in the repo and in the test matrix, but live Sepolia broadcast still requires Starknet bindings.

## Current live Sepolia addresses

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

## Validation

The active verification set for this release is:

1. `npm test`
2. `npm run frontend:build`
3. live contract readback from Sepolia:
   - registry `layerCount() == 13`
   - registry `nextAssetId() == 495`
   - registry `nextVariantId() == 469`
   - layer `6` name is `BodyBase`
   - frontend contracts config points at the new `PhilNFT`
   - marketplace points at the new `PhilTestMint`

## 4337 follow-up

The remaining requirements for the live 4337 Sepolia rollout are:

- `STARKNET_CORE`
- `L2_UNLOCK_VERIFIER`
- `ALLOWLIST_SIGNER_KEY`
- `PAYMASTER_SIGNER_KEY`
- optional `PAYMASTER_DEPOSIT`

When those are configured, the intended follow-up is:

```bash
node scripts/deploy_4337.mjs
npm run verify:sepolia
```

## Notes for reviewers

- The repo intentionally keeps the old mint / renderer / marketplace surface.
- The primary architectural change in this release is the new art backend and layer structure.
- `BodyBase` is independent from `Body`, with a strong bias away from same-color matches.
- SVG uploads remain raw and uncompressed.
