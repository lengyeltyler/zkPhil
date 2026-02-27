# TEST13 Audit Report

## 1) Executive summary

This repository is a mixed Solidity, Cairo, Node, frontend, and backend stack for the Test13 mint flow and related account/paymaster infrastructure. The core Test13 Solidity path is materially functional in local EVM simulation: contracts compile, the main local Test13 E2E run passes, replay protection is enforced, and the current `ProofGateTest13` design includes explicit domain separation, expiry checks, authorized caller gating, and per-action nullification.

The release decision for a mainnet launch in the next 24 hours is **NO-GO** in the repo's current state. The primary issue is not the core `ProofGateTest13` contract itself, but the surrounding operational and integration stack: the 4337 flow, paymaster logic, frontend calldata generation, backend proof payloads, and multiple validation scripts are still wired to older interfaces and do not match the current contracts. In parallel, the documented deploy stack is intentionally local-only, several security/invariant tests are stale, and some reproducibility and environment assumptions are unsafe for a mainnet release.

Net assessment:

- Core local Test13 mint path: **works in local simulation**
- Mainnet deployment path: **not implemented / not safe yet**
- 4337 + paymaster + frontend/backend integration: **interface mismatched**
- CI confidence: **reduced by stale or failing tests**
- Mainnet in 24 hours: **not recommended without blocker remediation**

## 2) Repro steps I ran

### Environment baseline

- Working directory: `/Users/tylershome/Library/Mobile Documents/com~apple~CloudDocs/phil_replica_candidate`
- `node -v`: `v20.20.0`
- `npm -v`: `10.8.2`
- `pnpm -v`: not installed
- `yarn -v`: not installed
- `git status`: failed, `fatal: not a git repository`
- `git rev-parse HEAD`: failed, `fatal: not a git repository`

### Project structure and detected toolchain

Key directories present:

- `contracts/`
- `scripts/`
- `test/`
- `cairo/`
- `server-ts/`
- `shared/`
- `sharpAccountV1/`
- `frontend/`
- `frontend-local/`
- `docs/`
- `deployments/`

Detected build systems / tools:

- Hardhat (`hardhat.config.cjs`)
- Solidity compiler via Hardhat and a manual `solc` pipeline (`scripts/local/compileContracts.mjs`)
- Scarb / Cairo (`cairo/Scarb.toml`, `sharpAccountV1/cairo/Scarb.toml`)
- Node test runner / Mocha-style tests in different parts of the repo

### Commands and results

| Command | Result | Notes |
|---|---|---|
| `npm ci` | Pass | Warned that `starknet@9.2.1` requires Node `>=22`; 43 vulnerabilities reported |
| `cd server-ts && npm ci` | Pass | 7 vulnerabilities reported |
| `npm run compile` | Pass | Manual compile wrote to `artifacts/manual-compile` |
| `npx hardhat compile` | Pass | 11 Solidity files compiled successfully |
| `cd server-ts && npm run build` | Pass | TypeScript build succeeded |
| `cd server-ts && npm test` | Pass | 4 tests passed |
| `npm test` | Fail | 17 passed, 1 failed in `test/palette-mapping.test.mjs` |
| `npm run test:proof-parity` | Pass | Proof parity checks passed |
| `npm run test:account` | Pass | Account tests passed |
| `npm run test:cadence` | Pass | Cadence mint tests passed |
| `npm run test:marketplace` | Pass | Marketplace tests passed |
| `npm run sharp:test` | Fail | `scarb build` wrapper uses unsupported `--manifest-path` |
| `node --test test/protocol-security.test.js` | Fail | Uses `describe`, incompatible with Node test runner |
| `npx hardhat test test/protocol-security.test.js` | Fail | Uses stale `ProofGateTest13` constructor / old ABI assumptions |
| `npm run test13:e2e` | Pass | Local E2E Test13 flow passed; minted all 13 and validated replay protection |
| `npm run local:e2e` | Pass | Wrote `artifacts/local-e2e/report.json` |
| `cd cairo && scarb build` | Pass | Cairo package builds |
| `cd cairo && scarb test` | Pass | 3 tests passed; deprecation warning only |
| `cd sharpAccountV1/cairo && scarb build` | Fail | Cairo type mismatch in `account_intent.cairo` |
| `PRIVATE_KEY=... npm run proofs:local` | Pass | Generated `artifacts/proof_package.json` |
| `npm run node` | Pass | Hardhat node started for local deploy checks |
| `node scripts/deploy_stark.mjs` | Pass | Local-only deployment script succeeded |
| `MOCK_UNLOCK_INBOX=1 node scripts/deploy_4337.mjs` | Pass | Local-only 4337 deploy succeeded |
| `npm run local:check-initcode` | Fail | Deployment file path resolution breaks in a path containing spaces (`%20`) |
| `npm run local:check-account` | Fail, then Pass | Initially failed until backend started; then passed with caveats |
| `PROGRAM_HASH=... MERKLE_ROOT=... ADMIN_KEY=local PAYMASTER_SIGNER_KEY=... npm start` in `server-ts` | Pass | Backend started, but defaulted `DROP_ID` to `1` unless explicitly set |
| `npm run local:simulate-userop` | Fail | Missing deployment artifacts due to same path encoding issue |

### Minimal error excerpts and diagnosis

1. `npm test`

- Error excerpt: `AssertionError: source svg missing mutable color #1a1a2e for phil 0`
- Diagnosis: the mutable palette spec in `shared/phil-renderer/phil-palettes-v2.json` includes `#1a1a2e`, but the expected source SVG (`Layers/Phil0.svg`) does not contain it.
- Recommendation: reconcile the palette map and source SVGs before using this test as a release gate.

2. `npm run sharp:test`

- Error excerpt: `scarb build failed: error: unexpected argument '--manifest-path' found`
- Diagnosis: the wrapper script `sharpAccountV1/scripts/build.mjs` uses an outdated Scarb CLI invocation.
- Recommendation: update the wrapper for the installed Scarb version and then fix the underlying Cairo compile errors.

3. `npx hardhat test test/protocol-security.test.js`

- Error excerpt: `incorrect number of arguments to constructor`
- Diagnosis: the test still deploys an older `ProofGateTest13` constructor signature and does not match the current contract.
- Recommendation: rewrite this suite against the current `ProofGateTest13` constructor and proof model before trusting it as a security gate.

4. `cd sharpAccountV1/cairo && scarb build`

- Error excerpt: `Unexpected argument type. Expected: "core::array::Span::<core::integer::u256>", found: "@core::array::Array::<core::integer::u256>"`
- Diagnosis: the Cairo source in `sharpAccountV1/cairo/src/account_intent.cairo` is incompatible with the installed toolchain / current API expectations.
- Recommendation: fix the Cairo source and re-validate generated artifacts before any release that depends on SharpAccountV1.

5. `npm run local:check-initcode` and `npm run local:simulate-userop`

- Error excerpt: `Missing deployment file: .../Mobile%20Documents/.../deployments/4337_31337.json`
- Diagnosis: these scripts use `new URL(import.meta.url).pathname`, which leaves `%20` path encoding intact and breaks local files in a workspace path containing spaces.
- Recommendation: use `fileURLToPath(import.meta.url)` to resolve filesystem paths safely.

## 3) Findings table

| Severity | Area | Description | Evidence | Fix recommendation |
|---|---|---|---|---|
| Blocker | ops / account / proof gate | The 4337, frontend, and backend stack still encodes old account-creation and mint ABIs, so the current integration layer does not match deployed contracts. | `contracts/PhilAccountFactory.sol` disables `createPhilAccount(address,uint256)` and requires `createPhilAccount(address,uint256,IProofGate.MintProof)`; `frontend/userop.js`, `frontend/mint.js`, `server-ts/src/routes/computeAccount.ts`, `server-ts/src/routes/signPaymaster.ts`, `scripts/check_account_derivation.mjs`, `scripts/check_initcode_sender.mjs`, and `scripts/simulate_userop.mjs` still use the old 2-arg account factory ABI and old mint calldata shape. | Update all off-chain callers to the current contract ABI, regenerate selectors, and then re-run a full 4337 end-to-end flow including first account deployment and mint. |
| Blocker | ops / paymaster | The paymaster is hardcoded to the old `PhilTestMint.mint` selector and calldata length assumptions, so it will reject current mint calldata. | `contracts/PhilPaymaster.sol` hardcodes `MINT_SELECTOR` for the old mint signature and validates `innerLength == 4 + 32 * 15`; the current mint path includes a structured `MintProof`. | Update `PhilPaymaster.sol` to the current mint ABI, re-audit calldata decoding, and re-test paymaster sponsorship against current frontend/backend payloads. |
| Blocker | ops / backend | The backend proof service still returns the old fact/output payload model rather than the current `IProofGate.MintProof` fields expected by the contracts. | `server-ts/src/routes/requestMint.ts` returns `{factHash, outputs, nullifier, dropId, programHash, merkleRoot}` while current contracts consume `MintProof { expiry, factHash, merkleProof, signature }`. | Rewrite the mint request API to emit the current proof payload, then update frontend callers and re-run E2E using the real backend path instead of local mock assumptions. |
| Blocker | ops / deploy | There is no usable mainnet deployment path in this repo today; the deploy and server scripts are explicitly locked to local development assumptions. | `scripts/deploy_stark.mjs` rejects non-`127.0.0.1:8545` RPCs; `scripts/deploy_4337.mjs` rejects non-`31337`, uses `hardhat_setCode`, and injects a local EntryPoint mock; `server-ts/src/index.ts` rejects non-local RPC/chain. | Build a dedicated mainnet deploy runbook and scripts: explicit chain config, confirmations, idempotency, verification, and production-safe RPC / key handling. |
| Blocker | build / tooling | Critical local validation scripts fail in this workspace because filesystem paths are decoded incorrectly when the path contains spaces. | `scripts/check_initcode_sender.mjs` and `scripts/simulate_userop.mjs` use `new URL(import.meta.url).pathname`, producing `%20` in filesystem paths. | Replace URL pathname usage with `fileURLToPath(import.meta.url)` and re-run local validation helpers from the actual repo path. |
| High | build / test | The root test suite is not clean: one palette mapping test fails, so CI is already red at the repo level. | `test/palette-mapping.test.mjs` fails because `shared/phil-renderer/phil-palettes-v2.json` expects `#1a1a2e`, but `Layers/Phil0.svg` does not include it. | Decide whether the palette spec or SVG source is canonical, then align them and keep the test as a gating check. |
| High | proof gate / test | The `protocol-security` suite is stale and does not exercise the current `ProofGateTest13` deployment or proof model. | `test/protocol-security.test.js` deploys the old 5-argument constructor and older fact/satellite assumptions. | Rewrite this suite around the current constructor and add assertions for authorized caller checks, expiry, domain separation, and nullifier replay prevention. |
| High | build / cairo | `sharpAccountV1` is not build-ready: the wrapper uses an outdated Scarb flag and the Cairo source itself fails to compile. | `sharpAccountV1/scripts/build.mjs` calls `scarb build --manifest-path ...`; `sharpAccountV1/cairo/src/account_intent.cairo` passes `Array<u256>` where `Span<u256>` is required. | Fix the wrapper to current Scarb usage, update the Cairo code to the current API, and re-generate/re-validate any derived Solidity artifacts. |
| High | build determinism | The repo claims Node `>=18.20.0`, but a pinned dependency requires Node `>=22`, so the stated environment contract does not match actual install requirements. | Root `package.json` allows Node 18+, but `npm ci` warns `starknet@9.2.1` requires `node: '>=22'`. | Pin and document the real supported Node version, ideally in `.nvmrc` / CI, and align package engine declarations with dependency constraints. |
| High | ops / secrets | A real `.env` file exists at repo root with secret-bearing keys, which is a material operational risk if mishandled. | Root `.env` includes keys such as `PRIVATE_KEY` and `DEPLOYER_PRIVATE_KEY`. This workspace is also not a visible git repo here, so ignore rules cannot be verified from the working copy. | Treat the current keys as exposed until proven otherwise, rotate before mainnet, move production secrets to a secret manager or deployment environment, and verify `.env` is excluded from all distribution paths. |
| Medium | proof gate | `ProofGateTest13` itself is materially stronger than the surrounding integration and includes key protections that should be preserved. | `contracts/ProofGateTest13.sol` binds proofs to `DROP_ID`, `block.chainid`, `address(this)`, action parameters, enforces `expiry`, checks authorized caller, and nullifies `keccak256(recipient, actionType, factHash)`. | Keep this contract shape as the baseline, and ensure every off-chain component exactly mirrors its proof inputs and calldata format. |
| Medium | account | `PhilAccount` enforces proof approval on execution and adds policy-layer 2FA for higher-risk scopes, but `initVaultConfig` is only protected by one-time initialization. | `contracts/PhilAccount.sol` gates `execute` and `executeBatch` through `approvedActionHash`; `initVaultConfig` only checks `unlockInbox == 0` before allowing initialization. | Confirm the deployment model guarantees trusted initialization; if any external caller could front-run init, add explicit access control or factory-only initialization. |
| Medium | ops | The backend defaults to `DROP_ID=1`, which can silently misconfigure a Test13 launch if the operator forgets to set it. | `server-ts/src/index.ts` starts with `DROP_ID` defaulting to `1`; observed at runtime during local start. | Remove the default or fail closed when `DROP_ID` is not explicitly set in production. |
| Medium | build determinism | `sharpAccountV1/scripts/build.mjs` mutates Solidity source in place when rewriting `PROGRAM_HASH`, which weakens reproducibility and source integrity. | The build script rewrites `sharpAccountV1/contracts/SharpAccount.sol` before restoring it. | Replace in-place source mutation with generated constants, templating, or constructor parameters so build inputs remain stable and reviewable. |
| Low | token | The active token mint contracts include explicit supply and parameter bounds, which is good, but should still be re-checked after frontend migration. | `contracts/PhilTestMint.sol` enforces `MAX_SUPPLY = 13` and validates variant ranges; `contracts/Phil369CadenceMint.sol` enforces cadence and reserve rules. | After ABI migrations, re-run mint path tests to confirm these constraints remain correctly surfaced in UI and 4337 flows. |
| Low | docs | The repo README and local scripts skew toward local rendering / local E2E workflows rather than a production deployment narrative. | Current root docs emphasize local flows such as `local:e2e`, `dev:e2e`, and local service assumptions. | Add a production-focused deployment document with explicit chain, key, verification, and rollback procedures. |
| Info | mainnet safety | No `tx.origin` or obvious `delegatecall` usage was found in the audited Solidity paths, which reduces common footgun exposure. | Reviewed `contracts/` paths relevant to Test13, `PhilAccount`, and `ProofGateTest13`. | Maintain this constraint and keep it as a review checklist item for future changes. |

## 4) Mainnet in 24 hours runbook (minimal safe path)

This is the minimal safe runbook if the goal is to decide whether mainnet launch is possible within approximately 24 hours.

### Recommended decision

- Current status: **NO-GO**
- Reason: the core Test13 local path works, but the production-adjacent integration path (frontend, backend, paymaster, deploy tooling, validation scripts) is not aligned with the current contracts.

### Must-fix before mainnet (blockers)

| Item | Effort | Files involved |
|---|---|---|
| Align all off-chain callers to the current `PhilAccountFactory` and `PhilTestMint` ABIs | M | `frontend/userop.js`, `frontend/mint.js`, `server-ts/src/routes/computeAccount.ts`, `server-ts/src/routes/signPaymaster.ts`, `scripts/check_account_derivation.mjs`, `scripts/check_initcode_sender.mjs`, `scripts/simulate_userop.mjs` |
| Update the backend mint API to emit the current `MintProof` structure | M | `server-ts/src/routes/requestMint.ts`, related callers in `frontend/` |
| Update `PhilPaymaster` for the current mint selector and calldata model, then re-test end-to-end | M | `contracts/PhilPaymaster.sol`, corresponding backend/frontend callers |
| Create a real mainnet deployment path with confirmation, verification, and non-local RPC support | M-L | `scripts/deploy_stark.mjs`, `scripts/deploy_4337.mjs`, `server-ts/src/index.ts`, deployment docs |
| Fix path handling in local validation scripts so the documented validation flow actually runs in this workspace | S | `scripts/check_initcode_sender.mjs`, `scripts/simulate_userop.mjs` |
| Rotate and re-home any private keys currently stored in `.env` before production use | S | `.env`, deployment/operator process |

### Should-fix soon (high priority)

| Item | Effort | Files involved |
|---|---|---|
| Repair the stale `protocol-security` suite to match current contracts | M | `test/protocol-security.test.js` |
| Fix the failing palette mapping test and make root CI green | S | `test/palette-mapping.test.mjs`, `shared/phil-renderer/phil-palettes-v2.json`, `Layers/Phil0.svg` |
| Align documented and actual Node runtime requirements | S | `package.json`, CI config, environment docs |
| Fail closed when `DROP_ID` is unset instead of defaulting to `1` | S | `server-ts/src/index.ts` |
| Repair `sharpAccountV1` build or explicitly exclude it from release scope | M | `sharpAccountV1/scripts/build.mjs`, `sharpAccountV1/cairo/src/account_intent.cairo`, related docs |

### Nice-to-have (non-blocking if the blockers are fixed first)

| Item | Effort | Files involved |
|---|---|---|
| Remove in-place source mutation from the SharpAccountV1 build process | M | `sharpAccountV1/scripts/build.mjs`, `sharpAccountV1/contracts/SharpAccount.sol` |
| Add explicit production docs / checklists for deploy, verify, and rollback | S | `README.md`, `docs/` |
| Add explicit CI jobs for local E2E, current proof-path tests, and Node version enforcement | M | CI configuration, package metadata |

### Minimal safe operator procedure after blockers are fixed

1. Environment setup

- Use the exact Node version validated by CI after the engine mismatch is resolved.
- Load production secrets from a secure environment or secret manager, not from a checked-out `.env`.
- Set `DROP_ID=13` explicitly and fail startup if it is missing.
- Use a production RPC endpoint and chain configuration with explicit chain ID checks.

2. Deploy steps

- Run a production-safe deploy script that does not rely on local-only Hardhat RPC methods.
- Deploy contracts with explicit confirmation depth, deterministic config capture, and address output to a versioned deployment artifact.
- If deploying a paymaster or backend-coupled component, verify selector/call-data compatibility against the current contracts before funding anything.

3. Verification steps

- Verify deployed bytecode and constructor args on the target chain.
- Run a post-deploy smoke test that exercises the exact backend-generated `MintProof` path.
- Run a full first-time account deployment + mint through the actual 4337/paymaster route, not just direct contract calls.
- Confirm replay protection by repeating the exact same proof and confirming rejection.

4. Post-deploy checks

- Confirm the expected `authorizedCaller` in `ProofGateTest13`.
- Confirm `PhilAccountFactory` derived addresses match off-chain derivation code.
- Confirm mint cap, token URI generation, and trait decoding for a sample mint.
- Monitor for proof submission failures, sponsorship rejection, and mismatched `DROP_ID` or chain ID errors.

## 5) Targeted security and correctness notes

### A) Mainnet safety

- Current deployment and backend scripts are explicitly local-only and should not be used for mainnet as-is.
- Secrets are present in a root `.env`, which is an operational risk until rotated and handled in a secure channel.
- There is no evidence of a production-safe deploy flow with idempotency, confirmation handling, or explorer verification baked into the current scripts.

### B) Proof gate and account model

- `ProofGateTest13` includes meaningful protections: authorized caller gating, expiry checks, merkle inclusion, ECDSA recovery against the recipient, chain/domain separation, and replay protection via a per-proof nullifier.
- `PhilAccount` enforces proof approval at execution time and adds policy-layer 2FA for higher-risk scopes, but deployment/initialization assumptions around `initVaultConfig` should be explicitly validated.
- The surrounding fact-registry / proof service scripts are inconsistent: some legacy code still assumes the older fact/output model even though the current contract path uses direct `MintProof` verification in `ProofGateTest13`.

### C) Token / NFT logic

- The active mint contracts reviewed include explicit supply caps and basic bounds checking.
- The local Test13 E2E flow successfully minted all 13 tokens and validated token metadata / token URI behavior in local simulation.
- The largest token-path risk is not the Solidity itself, but that several frontend and paymaster callers still encode the old mint ABI.

### D) Key management and operational security

- Secrets currently appear to be sourced from `.env`, including deployer/private key material.
- Mainnet process should use hardware-backed or managed signing where possible, with short-lived env injection only at execution time.
- Treat any locally stored deploy keys as compromised unless their handling history is known and controlled.

### E) Build determinism

- Root dependency versions are mostly pinned and `npm ci` works, but the effective Node version contract is inconsistent because of `starknet@9.2.1`.
- `server-ts` uses lockfiles but package ranges are looser (`^` ranges), which is acceptable only if installs are always done with the lockfile.
- `sharpAccountV1` currently weakens reproducibility by mutating Solidity source during build.

### F) Known footguns

- No obvious `tx.origin` usage was found in the core Solidity path.
- No obvious `delegatecall` use was found in the reviewed Test13 path.
- The dominant footguns here are stale ABIs, stale tests, silent config defaults (`DROP_ID=1`), local-only deploy assumptions, and mismatched off-chain/on-chain proof schemas.

## 6) Final launch call

- **Mainnet Test13 launch within ~24 hours: NO-GO**
- Reason: the core contract path is promising, but the production integration path is not internally consistent yet.
- Earliest credible GO condition: after ABI alignment, backend proof payload alignment, paymaster fix, production-safe deploy path, path-resolution fixes, and a fresh end-to-end 4337 test against the current contracts.

## 7) Diff section

No repository code patches were applied during this audit.

- No files were renamed, moved, deleted, or refactored.
- No test or source changes were made.
- Only this report file was added.
