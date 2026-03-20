# zkPhil

zkPhil keeps Phil Ethereum-native and uses local Cairo + S-two proving for eligibility-based identity issuance.

The trusted backend signer flow has been removed from identity authorization. The backend now prepares recipient-bound eligibility payloads, the user device runs Cairo locally, and Solidity accepts only fact-registry-backed eligibility claims for the expected Phil identity issuance.

Code is licensed under [MIT](./LICENSE). SVG artwork in [`zkPhilLayers/`](./zkPhilLayers) is released under [CC0 1.0](./LICENSE-ARTWORK).

## Eligibility flow

1. `POST /request-mint` returns a `provingRequest` with the recipient-bound witness bundle, claim hash, expected fact hash, and expected proof metadata.
2. The local prover service in [`scripts/proofs/local_prover_server.mjs`](./scripts/proofs/local_prover_server.mjs) runs `scarb execute` / `scarb prove` against [`cairo/`](./cairo).
3. The client submits the resulting proof payload to `POST /register-proof`.
4. [`contracts/PhilIdentityGate.sol`](./contracts/PhilIdentityGate.sol) consumes only fact-registry-backed proofs. Backend ECDSA signatures are no longer accepted.

This keeps the product Ethereum-native while making the proving layer generic enough for:

- static eligibility lists
- future proof-of-human credentials
- other credential roots that can be expressed as Cairo eligibility programs

Production note:
- This repo does not implement direct onchain S-two verification.
- Production chains must use a fact registry bridge.
- Local chain `31337` uses [`contracts/proofs/DevProofVerifier.sol`](./contracts/proofs/DevProofVerifier.sol) as a dev-only registry.

## Local proving commands

Build an eligibility bundle:

```bash
node scripts/proofs/build_eligibility_bundle.mjs \
  --in eligibility.json \
  --out artifacts/proofs/eligibility-bundle.json \
  --contextId 13
```

Run the local prover service for the browser/frontend:

```bash
node scripts/proofs/local_prover_server.mjs
```

Generate one proof artifact from a saved request:

```bash
node scripts/proofs/prove_local.mjs \
  --request artifacts/proofs/request.json \
  --out artifacts/proofs/local-proof-artifact.json \
  --prove
```

Optional local verification:

```bash
node scripts/proofs/prove_local.mjs \
  --request artifacts/proofs/request.json \
  --out artifacts/proofs/local-proof-artifact.json \
  --prove --verify
```

## Setup

```bash
npm install
cd server-ts && npm install && cd ..
cp .env.example .env
```

Minimum local-proving env:

- `RPC_URL`
- `CHAIN_ID`
- `PRIVATE_KEY`
- `PROGRAM_HASH`
- `CONTEXT_ID`
- `ELIGIBILITY_BUNDLE_PATH`
- `PAYMASTER_SIGNER_KEY`

If you are running on local `31337`, also set:

- `FACT_REGISTRY_OPERATOR_KEY`

If you are targeting Sepolia/public chains, set:

- `FACT_REGISTRY`

## Common commands

```bash
npm run compile
npm run test:node
npm run test:hardhat
cd server-ts && npm test
npm run proofs:build-bundle
npm run proofs:prove-server
```

## Key docs

- Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Review packet: [`REVIEW_PACKET.md`](./REVIEW_PACKET.md)
- Migration notes: [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md)
- Refactor summary: [`REFRACTOR_SUMMARY.md`](./REFRACTOR_SUMMARY.md)
