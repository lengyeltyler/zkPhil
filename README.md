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

## Fast paths

- Local CI-safe smoke: `npm run smoke:local`
- Local helper control: `npm run local:up -- --fresh`, `npm run local:status`, `npm run local:down`
- Sepolia status: `npm run status:sepolia`
- Strict live Sepolia verification: `npm run verify:sepolia`

## Stable vs mutable infrastructure

- Stable Sepolia trait/data infrastructure now lives in [`config/stable-art-backends/sepolia.json`](./config/stable-art-backends/sepolia.json).
- Stable Sepolia protocol bindings now live in [`config/stable-protocol-bindings/sepolia.json`](./config/stable-protocol-bindings/sepolia.json).
- App-specific Starknet unlock-sender bindings now live under [`config/starknet-app-bindings/`](./config/starknet-app-bindings/).
- That manifest is the intended reused base for `PhilSVGStorage`, `PhilLayerRegistry`, and `PhilNFT` on Sepolia.
- The stable protocol manifest is the intended reused base for `EntryPoint v0.7` and `StarknetCore` on Sepolia.
- Mutable L1 identity/proof/account infrastructure still writes per-chain deployment manifests under `deployments/`, for example `stark_<chainId>.json` and `4337_<chainId>.json`.
- Those mutable manifests now use `zkphil-mutable-stack-v1` when written by the current deploy scripts and split their contents into `components`, `dependencies`, `config`, and `status`.
- `status:sepolia` also understands older flat manifests and will call them out as `legacy-flat-json`, `partial`, or alias-backed instead of pretending they are current.
- The live current Sepolia identity/proof stack is now tracked in `deployments/stark_11155111.json`.
- The missing public-chain app binding is now explicit: `config/starknet-app-bindings/sepolia.json` must track a real Starknet `PhilUnlockSender` before Sepolia 4337 deployment can complete honestly.
- `deployments/4337_11155111.json` remains intentionally absent until that Starknet app binding exists and the L1 account/paymaster stack is actually deployed.
- Local helper runs reuse healthy local manifests when possible and only re-bootstrap the art backend when the local chain is fresh or the manifest is unhealthy.

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
  --out generated/proofs/mock-humanity-bundle.json \
  --proofContext 13
```

Build the original local-credential bundle:

```bash
npm run proofs:build-bundle -- \
  --in credentials.json \
  --out generated/proofs/credential-bundle.json \
  --proofContext 13
```

Run the local prover service:

```bash
npm run proofs:prove-server
```

Run the direct mock-humanity CLI flow after the chain, backend, and prover are up:

```bash
npm run local:mock-flow
```

Build the Starknet unlock sender package:

```bash
npm run starknet:build-unlock-sender
```

Attempt the real Starknet Sepolia unlock-sender deployment once Starknet RPC/account credentials exist:

```bash
npm run starknet:deploy-unlock-sender
```

After a real L1 `PhilUnlockInbox` exists, bind the Starknet sender to that inbox:

```bash
npm run starknet:set-unlock-recipient
```

## Local dev quick start

One-command smoke path:

```bash
npm run smoke:local
```

Manual helper path:

```bash
npm run local:up -- --fresh
npm run local:status
```

That helper bootstraps:

- local Hardhat chain
- stable Node 22 runtime selection for local services
- mock-humanity bundle
- contract deployments
- local prover
- backend

Useful helper commands:

```bash
npm run local:status
npm run local:down
bash scripts/run_local_e2e.sh clean
```

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
npm run local:down
```

The helper writes logs under `.local-dev/` and keeps reusable manifests under `deployments/`.
Bundle artifacts now live under `generated/proofs/` so compile steps do not wipe them.

For the fully explicit manual workflow, use [`DEV_RUNBOOK.md`](./DEV_RUNBOOK.md).

## Sepolia status

`npm run status:sepolia` reports the stable reused art/data addresses, the stable reusable protocol bindings, the Starknet app unlock-sender binding, the mutable Stark and 4337 manifests, legacy alias usage, placeholder config, and whether live verification ran or was skipped.

Current Sepolia truth:

- `deployments/stark_11155111.json` is current and complete for the humanity-ready identity/proof stack
- `config/stable-protocol-bindings/sepolia.json` now tracks the reused Sepolia `EntryPoint v0.7` and `StarknetCore`
- `config/starknet-app-bindings/sepolia.json` is still intentionally missing because no real Starknet `PhilUnlockSender` has been deployed and tracked from this repo yet
- `deployments/4337_11155111.json` is therefore still missing because the L1 account/paymaster stack has not been deployed against a tracked Starknet unlock sender
- `verify:sepolia` therefore still fails closed honestly

The mutable Sepolia states are classified as:

- `complete`
  - required mutable manifests and linked config are present
- `partial`
  - a manifest exists but required contracts or dependencies are still missing, or the manifest is still legacy/alias-backed
- `missing`
  - no mutable manifest is present for that Sepolia layer
- `placeholder-configured`
  - manifests are present, but required live-verification config still comes from placeholders

The current expected mutable Sepolia manifest paths are:

- `deployments/stark_11155111.json`
- `config/starknet-app-bindings/sepolia.json`
- `deployments/4337_11155111.json`

`npm run verify:sepolia` is the stricter compatibility alias for live verification when a usable Sepolia RPC and signer config are available.

## Environment highlights

Primary:
- `HUMANITY_PROVIDER`
- `CREDENTIAL_BUNDLE_PATH`
- `MOCK_HUMANITY_BUNDLE_PATH`
- `PROOF_CONTEXT`
- `RPC_URL`
- `RPC_URL_SEPOLIA`
- `PAYMASTER_SIGNER_KEY`

Optional:
- `ART_BACKEND_MODE`
- `ART_BACKEND_MANIFEST_PATH`
- `FACT_REGISTRY`
- `FACT_REGISTRY_OPERATOR_KEY`
- `ENTRY_POINT_V07`
- `PAYMASTER_SIGNER`
- `STARKNET_CORE`
- `STARKNET_RPC_URL`
- `STARKNET_RPC_URL_SEPOLIA`
- `STARKNET_ACCOUNT_ADDRESS`
- `STARKNET_PRIVATE_KEY`
- `L2_UNLOCK_SENDER`
- `L2_UNLOCK_VERIFIER` as a legacy compatibility alias only
- `L1_UNLOCK_RECIPIENT`
- `LOCAL_PROVER_HOST`
- `LOCAL_PROVER_PORT`
- `NODE_BIN`

Sepolia mutable-manifest fallbacks:
- `PROOF_GATE`
- `PHIL_IDENTITY_MINT`
- `PHIL_ACCOUNT_FACTORY`
- `PHIL_PAYMASTER`

Sepolia binding resolution now follows three layers:

- reused protocol values: `ENTRY_POINT_V07` and `STARKNET_CORE` can fall back to `config/stable-protocol-bindings/sepolia.json`
- app-specific Starknet unlock sender: `L2_UNLOCK_SENDER` can fall back to `config/starknet-app-bindings/sepolia.json`
- mutable L1 account/paymaster deployment: `PAYMASTER_SIGNER`, `PHIL_ACCOUNT_FACTORY`, `PHIL_PAYMASTER`, and the final wired `L2_UNLOCK_SENDER` can resolve from `deployments/4337_11155111.json` once that stack is live

`L2_UNLOCK_VERIFIER` remains accepted as a compatibility alias, but it is no longer the canonical name.

Generic bundle-path and old proof-context compatibility aliases from earlier refactors have been removed from the active tracked workflow.

See [`.env.example`](./.env.example) for the full template.

## Relevant tests

```bash
scarb --manifest-path cairo/Scarb.toml test
scarb --manifest-path starknet/Scarb.toml build
cd server-ts && npx vitest --run src/lib/eligibility.test.ts src/routes/status.test.ts src/routes/requestMint.test.ts src/routes/requestMint.production.test.ts src/routes/signPaymaster.test.ts
node --test test/starknet-app-bindings.test.mjs test/eligibility-proof.contract.test.mjs test/mock-humanity.contract.test.mjs test/error-cases.contract.test.mjs test/verify-sepolia-bindings.test.mjs
node --test test/sepolia-status.test.mjs
```

## Docs

- Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Cleanup report: [`CLEANUP_REPORT.md`](./CLEANUP_REPORT.md)
- DEV runbook: [`DEV_RUNBOOK.md`](./DEV_RUNBOOK.md)
- Project status: [`PROJECT_STATUS_REPORT.md`](./PROJECT_STATUS_REPORT.md)
- Final project status: [`FINAL_PROJECT_STATUS.md`](./FINAL_PROJECT_STATUS.md)
- Repo modernization report: [`REPO_MODERNIZATION_REPORT.md`](./REPO_MODERNIZATION_REPORT.md)
- Sepolia 4337 modernization report: [`SEPOLIA_4337_MODERNIZATION_REPORT.md`](./SEPOLIA_4337_MODERNIZATION_REPORT.md)
- Unlock sender implementation report: [`UNLOCK_SENDER_IMPLEMENTATION_REPORT.md`](./UNLOCK_SENDER_IMPLEMENTATION_REPORT.md)
- Migration notes: [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md)
- Humanity-ready summary: [`HUMANITY_READY_SUMMARY.md`](./HUMANITY_READY_SUMMARY.md)
