# PROJECT_STATUS_REPORT

## Current architecture

zkPhil is now split into four practical layers:

1. Cairo proving layer
   - `cairo/src/credential.cairo` still defines the claim computation and public outputs.
   - local proving still runs through the S-two-backed helper path and emits the proof artifact consumed by the app flow.

2. Verification and gating layer
   - `PhilIdentityGate` remains the shared nullifier, replay, and binding gate.
   - `IHumanityVerifier` remains the provider abstraction.
   - `FactRegistryHumanityVerifier` remains the production-oriented verifier bridge.
   - `MockHumanityVerifier` remains a DEV/TEST-only verifier that simulates future proof-of-human semantics.

3. Identity and account layer
   - `PhilIdentityMint` mints the identity NFT after the gate consumes a valid proof.
   - `PhilAccountFactory`, `PhilAccount`, `PhilUnlockInbox`, and `PhilPaymaster` provide the current ERC-4337 account path.

4. Helper and client layer
   - the backend prepares proving requests and records proof registrations, but it is not a mint-signing trust root.
   - the local prover helper executes Cairo locally.
   - the frontend and local smoke scripts exercise the full proof -> register -> mint path.

## Trust boundaries

Production-oriented trust boundaries:

- the backend is trusted for auth/session issuance and request preparation only
- proof consumption and nullifier spending happen onchain
- the active verifier bridge still depends on fact registration before the gate accepts a proof
- no backend mint-signing authority has been reintroduced

DEV/TEST-only trust boundaries:

- `HUMANITY_PROVIDER=mock` is explicitly non-production
- `MockHumanityVerifier` is limited to local testing semantics and does not claim real-world personhood
- local `DevProofVerifier` / fact registration is still a stand-in for a future stronger bridge

## Reused vs redeployed infrastructure

Stable reused infrastructure:

- tracked in `config/stable-art-backends/sepolia.json`
- intended reuse base on Sepolia:
  - `PhilSVGStorage`: `0x77C1A28296d39fb91F7575e85A4493E5036B8A4c`
  - `PhilLayerRegistry`: `0x43d8367eC689548325775DC0606F92d7193D4863`
  - `PhilNFT`: `0x0B0d8dE5C1d3ea3840C0951E9edcd4EA6F7d5585`

Mutable infrastructure:

- `deployments/stark_<chainId>.json`
  - identity gate
  - identity mint
  - humanity verifier
  - fact registry / proof verifier wiring
- `deployments/4337_<chainId>.json`
  - entry point
  - account factory
  - unlock inbox
  - paymaster
- `deployments/art_<chainId>.json`
  - local-only art bootstrap manifest when local trait/data contracts are deployed

Current deployment behavior:

- default Sepolia behavior now prefers the stable art/data manifest instead of redeploying trait/data contracts
- default local behavior prefers reusing a healthy local art manifest and only bootstraps fresh art contracts when needed
- explicit local full bootstrap is still available through `ART_BACKEND_MODE=deploy-local`

## What is production-oriented vs dev-only

Production-oriented today:

- provider-agnostic gate contract layout
- fact-registry-bridged verifier path
- local credential provider mode
- account abstraction plumbing
- stable Sepolia art/data reuse boundary

DEV/TEST-only today:

- `HUMANITY_PROVIDER=mock`
- sample mock humans and mock-humanity bundles
- helper-managed local chain/prover/backend stack
- local `EntryPointLocalMock` installation
- current end-to-end smoke flow driven by local scripts

## What still uses local S-two proving

The current proof generation path still centers on local Cairo execution plus S-two proof artifact generation:

- `/request-mint` prepares a provider-aware proving request
- `scripts/proofs/local_prover_server.mjs` calls `scripts/proofs/prove_local.mjs`
- the prover serializes the Cairo input as `Array<felt252>` and runs `scarb execute/prove`
- the backend accepts `/register-proof`
- the resulting fact is consumed through the current verifier bridge

## What still uses fact-registry bridging

The active verifier bridge is still fact-registry-based in both modes:

- local-credential mode uses `FactRegistryHumanityVerifier`
- mock-humanity mode still produces the same fact/public-output shape and registers it before the gate consumes the proof
- direct Ethereum-side verification of the S-two proof artifact is still not implemented

## Validation run performed on 2026-03-21

Commands run:

```bash
bash scripts/run_local_e2e.sh up --fresh
bash scripts/run_local_e2e.sh status
node scripts/local/mock_humanity_flow.mjs --walletA 2 --walletB 4 --mockHumanA briar --mockHumanB delta
npm run compile
scarb --manifest-path cairo/Scarb.toml test
cd server-ts && npx vitest --run src/lib/eligibility.test.ts src/routes/status.test.ts src/routes/requestMint.test.ts src/routes/requestMint.production.test.ts src/routes/signPaymaster.test.ts
cd ..
node --test test/art-backend-manifest.test.mjs test/art-batch-planning.test.mjs test/rpc-retry.test.mjs test/eligibility-proof.contract.test.mjs test/mock-humanity.contract.test.mjs test/error-cases.contract.test.mjs test/verify-sepolia-bindings.test.mjs test/frontend-connectivity.test.mjs
```

Successful outcomes:

- helper bring-up completed without manual retry loops after the hardening changes
- readiness checks reported healthy RPC, art backend, Stark core, 4337 stack, backend, and prover
- the explicit mock-humanity smoke flow completed:
  - `briar` minted token `2`
  - second use of `briar` was rejected
  - `delta` minted token `3`
- onchain post-check showed `totalSupply = 4`
- `npm run compile` passed
- Cairo tests passed: `5/5`
- server tests passed: `20/20`
- targeted node/integration tests passed: `13` passed, `1` skipped

Observed warnings but not failures:

- `scarb cairo-test` warns that `scarb test` is deprecated in favor of `snforge`
- Ganache fell back from native `µWS` to the NodeJS implementation in several test runs
- `test/frontend-connectivity.test.mjs` skipped because live Sepolia RPC gating was not enabled for this local validation run

## Bootstrap hardening status

The local bootstrap is materially stronger than before:

- RPC calls that previously failed on transient transport errors now use bounded retry/backoff helpers
- the helper pins a Node 22 runtime for backend/prover/bootstrap commands instead of inheriting a mismatched interactive shell runtime
- readiness checks now gate startup sequencing instead of assuming service availability
- local art bootstrap uses smaller upload batches and grouped chunk appends to avoid large single-call failures
- proof bundles now live under `generated/proofs/` so compile output cleanup does not delete them
- helper output and status checks now fail fast with direct logs/manifests when a dependency is unhealthy

## Current maturity assessment

What is in good shape now:

- the humanity-ready contract architecture
- local mock-humanity end-to-end testability
- replay and one-human-one-identity enforcement
- local bootstrap determinism
- separation between stable Sepolia art/data contracts and mutable identity/account deployments

What is still pre-production:

- the verifier bridge still depends on fact registration rather than direct onchain proof verification
- the backend and prover still form a developer workflow, not a hardened production proving network
- the mock-humanity provider is a simulator, not real proof-of-human verification
- the local helper stack still targets developer ergonomics over production-grade observability and orchestration

## Remaining risks and technical debt

Highest-value remaining work:

- migrate Cairo tests from the deprecated `scarb cairo-test` path to `snforge`
- add a dedicated smoke assertion script that records end-to-end results to a machine-readable file for CI
- improve visibility around long-running prove steps so the helper can expose progress rather than just readiness
- expand Sepolia verification checks so reused stable art/data manifests and mutable identity/account manifests can be validated together in one command
- continue reducing local dependence on Ganache fallbacks and mock EntryPoint patching where possible

Still-open architectural gaps before real human verification:

- integrate a real humanity provider behind `IHumanityVerifier`
- define the production verifier bridge that replaces or strengthens the current fact-registry path
- decide how real provider-specific credentials and nullifiers are sourced, transported, and audited

Still-open product/workflow gaps before a dependable app experience:

- clearer frontend status/progress around local prove time
- better persistence and surfacing of proof history for troubleshooting
- broader CI coverage of the full helper-managed bring-up and smoke flow

## Immediate next-step recommendations

1. Add a CI-safe local smoke command that wraps `run_local_e2e.sh up`, `mock_humanity_flow`, state assertions, and teardown.
2. Migrate the Cairo test target to `snforge` before the deprecated Scarb path becomes a blocker.
3. Add a single Sepolia verification/status command that reports both reused stable art/data addresses and mutable identity/account manifests together.
4. Start designing the real humanity-provider integration behind the existing verifier abstraction without disturbing the current local mock path.
