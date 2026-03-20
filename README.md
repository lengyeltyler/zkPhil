# zkPhil

zkPhil stays Ethereum-native and uses local Cairo + S-two proving for Phil identity issuance.

The active architecture is now humanity-ready:

- `PhilIdentityGate` is the identity/nullifier gate.
- `FactRegistryHumanityVerifier` is the current proof bridge implementation.
- the current local provider is a credential-commitment bundle proved locally in Cairo
- future proof-of-human providers such as World can plug in behind the humanity-verifier abstraction
- no backend signer authorizes minting anymore

World or any other third-party proof-of-human provider is not implemented in this repo yet.

## Identity flow

1. `POST /request-mint` returns a recipient-bound `provingRequest`.
2. The browser sends that request to the local prover at [`scripts/proofs/local_prover_server.mjs`](./scripts/proofs/local_prover_server.mjs).
3. Cairo runs locally and emits an S-two proof artifact plus the contract proof payload.
4. The client sends the proof payload to `POST /register-proof`.
5. [`contracts/PhilIdentityGate.sol`](./contracts/PhilIdentityGate.sol) accepts only fact-registry-backed proofs and consumes the identity nullifier.

## Current verifier model

- [`contracts/IHumanityVerifier.sol`](./contracts/IHumanityVerifier.sol) defines the provider-agnostic verifier abstraction.
- [`contracts/proofs/FactRegistryHumanityVerifier.sol`](./contracts/proofs/FactRegistryHumanityVerifier.sol) is the current implementation.
- [`cairo/src/credential.cairo`](./cairo/src/credential.cairo) proves a recipient-bound credential commitment against the current verifier config hash.
- the verifier config hash is currently a Merkle commitment root for the local credential bundle, but that is an implementation detail, not the product model

## Local proving commands

Build a credential bundle:

```bash
node scripts/proofs/build_credential_bundle.mjs \
  --in credentials.json \
  --out artifacts/proofs/credential-bundle.json \
  --proofContext 13
```

Run the local prover service:

```bash
node scripts/proofs/local_prover_server.mjs
```

Generate and optionally verify one proof artifact:

```bash
node scripts/proofs/prove_local.mjs \
  --request artifacts/proofs/request.json \
  --out artifacts/proofs/local-proof-artifact.json \
  --prove

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
- `PROOF_CONTEXT`
- `CREDENTIAL_BUNDLE_PATH`
- `PAYMASTER_SIGNER_KEY`

Local `31337` also needs:

- `FACT_REGISTRY_OPERATOR_KEY`

Public chains also need:

- `FACT_REGISTRY`

## Common commands

```bash
npm run compile
scarb --manifest-path cairo/Scarb.toml test
cd server-ts && npx vitest --run
npm run test:node
npm run test:hardhat
npm run test:legacy
npm run proofs:build-bundle
npm run proofs:prove-server
```

## Key docs

- Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Migration notes: [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md)
- Refactor summary: [`REFRACTOR_SUMMARY.md`](./REFRACTOR_SUMMARY.md)
- Humanity-ready summary: [`HUMANITY_READY_SUMMARY.md`](./HUMANITY_READY_SUMMARY.md)
- Review packet: [`REVIEW_PACKET.md`](./REVIEW_PACKET.md)
