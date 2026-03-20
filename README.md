# zkPhil

zkPhil stays Ethereum-native and keeps local Cairo + S-two proving at the center of Phil identity issuance.

The repo now supports two humanity-provider modes behind the same gate and fact-registry bridge:

- `HUMANITY_PROVIDER=local-credential`
  - production-oriented bridge mode for the current local credential-commitment flow
- `HUMANITY_PROVIDER=mock`
  - DEV/TEST ONLY mock-humanity mode for end-to-end Phil identity testing

World / World ID is still not implemented here.
No external World services are called.
The active verifier bridge is still fact-registry-based.

## Active identity architecture

- `PhilIdentityGate` is the provider-agnostic nullifier and replay gate.
- `IHumanityVerifier` is the verifier abstraction.
- `FactRegistryHumanityVerifier` is the production-oriented fact-registry verifier.
- `MockHumanityVerifier` is the DEV/TEST-ONLY local verifier for `HUMANITY_PROVIDER=mock`.
- Cairo + S-two still generate the proof artifact and public outputs.
- the backend prepares proving requests but is not a mint-signing trust root.

## Mock-humanity mode

`HUMANITY_PROVIDER=mock` simulates future proof-of-human semantics with:

- `mockHumanId`
- `humanitySecret`
- deterministic `identityNullifier`
- recipient-bound claim hashes
- one-human-one-identity nullifier consumption

This mode is only for local development and testing on `31337`.
It is not production security and it is not World ID.

## End-to-end flow

1. Authenticate the wallet with the backend.
2. Choose a mock human in DEV/TEST mode or use the local credential provider.
3. `POST /request-mint` returns a recipient-bound proving request.
4. The client sends that request to the local prover at [`scripts/proofs/local_prover_server.mjs`](./scripts/proofs/local_prover_server.mjs).
5. Cairo executes locally and emits an S-two artifact plus the contract proof payload.
6. The client sends the resulting proof payload to `POST /register-proof`.
7. `FactRegistryHumanityVerifier` or `MockHumanityVerifier` checks the registered fact.
8. [`contracts/PhilIdentityGate.sol`](./contracts/PhilIdentityGate.sol) consumes the identity nullifier.

## Core commands

Install dependencies:

```bash
npm install
cd server-ts && npm install && cd ..
```

Build a DEV/TEST mock-humanity bundle:

```bash
npm run proofs:build-mock-bundle -- \
  --in fixtures/mock_humans.dev.json \
  --out artifacts/proofs/mock-humanity-bundle.json \
  --proofContext 13
```

Build the original local-credential bundle:

```bash
npm run proofs:build-bundle -- \
  --in credentials.json \
  --out artifacts/proofs/credential-bundle.json \
  --proofContext 13
```

Run the local prover service:

```bash
npm run proofs:prove-server
```

Run the mock-humanity smoke flow after the chain, backend, and prover are up:

```bash
npm run local:mock-flow
```

## Local dev quick start

Helper script:

```bash
bash scripts/run_local_e2e.sh up
```

That helper bootstraps:

- local Hardhat chain
- mock-humanity bundle
- contract deployments
- local prover
- backend

Then serve the static frontend:

```bash
npx serve . -l 8080
```

Open:

```text
http://localhost:8080/frontend/mint.html?chainId=31337&server=http://127.0.0.1:8787&localProver=http://127.0.0.1:8747
```

Stop the helper-managed services:

```bash
bash scripts/run_local_e2e.sh down
```

For the fully explicit manual workflow, use [`DEV_RUNBOOK.md`](./DEV_RUNBOOK.md).

## Environment highlights

- `HUMANITY_PROVIDER`
- `HUMANITY_BUNDLE_PATH`
- `CREDENTIAL_BUNDLE_PATH`
- `MOCK_HUMANITY_BUNDLE_PATH`
- `PROOF_CONTEXT`
- `FACT_REGISTRY`
- `FACT_REGISTRY_OPERATOR_KEY`
- `LOCAL_PROVER_HOST`
- `LOCAL_PROVER_PORT`

See [`.env.example`](./.env.example) for the full template.

## Relevant tests

```bash
scarb --manifest-path cairo/Scarb.toml test
cd server-ts && npx vitest --run src/lib/eligibility.test.ts src/routes/status.test.ts src/routes/requestMint.test.ts src/routes/requestMint.production.test.ts src/routes/signPaymaster.test.ts
node --test test/eligibility-proof.contract.test.mjs test/mock-humanity.contract.test.mjs test/error-cases.contract.test.mjs test/verify-sepolia-bindings.test.mjs
```

## Docs

- Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- DEV runbook: [`DEV_RUNBOOK.md`](./DEV_RUNBOOK.md)
- Migration notes: [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md)
- Humanity-ready summary: [`HUMANITY_READY_SUMMARY.md`](./HUMANITY_READY_SUMMARY.md)
