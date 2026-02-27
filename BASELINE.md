# Baseline Report — phil_replica_candidate

Date: 2026-02-26
Workspace: `/Users/tylershome/Library/Mobile Documents/com~apple~CloudDocs/phil_replica_candidate`

## Environment

- `node -v` → `v20.20.0`
- `npm -v` → `10.8.2`

## Phase 0 Commands + Outputs

### 1) Install

Command:

```bash
npm ci
```

Output:

```text
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'starknet@9.2.1',
npm warn EBADENGINE   required: { node: '>=22' },
npm warn EBADENGINE   current: { node: 'v20.20.0', npm: '10.8.2' }
npm warn EBADENGINE }
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
npm warn deprecated glob@8.1.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

added 682 packages, and audited 712 packages in 13s

99 packages are looking for funding
  run `npm fund` for details

43 vulnerabilities (12 low, 10 moderate, 16 high, 5 critical)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
```

### 2) Compile

Command:

```bash
npm run compile
```

Output:

```text
> ogcopy@1.0.0 compile
> node scripts/local/compileContracts.mjs

Compiled 23 contracts to /Users/tylershome/Library/Mobile Documents/com~apple~CloudDocs/phil_replica_candidate/artifacts/manual-compile\n - Base64\n - ECDSA\n - ERC4337Factory\n - LibBytes\n - LibClone\n - LibString\n - LibZip\n - LocalSmartAccount\n - LocalSmartAccountFactory\n - MerkleProofLib\n - MockUnlockInbox\n - PhilAccount\n - PhilAccountFactory\n - PhilDSLDecoder\n - PhilFragments\n - PhilPalettes\n - PhilRenderer\n - PhilTestMint\n - PhilWeb3\n - ProofGateTest13\n - SSTORE2\n - SSTORE2Deployer\n - SignatureCheckerLib\n
```

### 3) Tests

Command:

```bash
npm test
```

Output:

```text
> ogcopy@1.0.0 test
> node --test test/palette-mapping.test.mjs test/fragments-dsl.test.mjs test/svg-render.integration.test.mjs test/allowlist-proof.contract.test.mjs test/frontend-selection.integration.test.mjs test/equivalence-snapshots.test.mjs test/error-cases.contract.test.mjs

TAP version 13
# bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
# Subtest: allowlist + proof gate contract behavior
ok 1 - allowlist + proof gate contract behavior
  ---
  duration_ms: 15992.305583
  ...
# Subtest: SVG renders match golden snapshots for all fixed test vectors
ok 2 - SVG renders match golden snapshots for all fixed test vectors
  ---
  duration_ms: 21.761
  ...
# Subtest: buildMixedSlotOrder matches golden snapshots for all fixed seeds and modes
ok 3 - buildMixedSlotOrder matches golden snapshots for all fixed seeds and modes
  ---
  duration_ms: 1.575792
  ...
# Subtest: buildPackedPaletteBytes matches golden hashes for all 6 phils
ok 4 - buildPackedPaletteBytes matches golden hashes for all 6 phils
  ---
  duration_ms: 1.427292
  ...
# Subtest: buildMerkleTree produces identical root and proofs for fixed address set
ok 5 - buildMerkleTree produces identical root and proofs for fixed address set
  ---
  duration_ms: 6.91375
  ...
# Subtest: computeClaimHash and computeFactHash match golden vectors
ok 6 - computeClaimHash and computeFactHash match golden vectors
  ---
  duration_ms: 9.180791
  ...
# Subtest: DSL encode/decode is stable across all fragment assets
ok 7 - DSL encode/decode is stable across all fragment assets
  ---
  duration_ms: 182.2085
  ...
# bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
# Subtest: error cases: mint input validation, gate restrictions, and supply cap
ok 8 - error cases: mint input validation, gate restrictions, and supply cap
  ---
  duration_ms: 16760.815875
  ...
# Subtest: dsl v2 encoder/decoder round-trip a representative svg snippet
ok 9 - dsl v2 encoder/decoder round-trip a representative svg snippet
  ---
  duration_ms: 1.757666
  ...
# Subtest: all DSL-encoded fragment payloads decode back to exact source snippet
ok 10 - all DSL-encoded fragment payloads decode back to exact source snippet
  ---
  duration_ms: 185.531584
  ...
# bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
# Subtest: frontend-selected combo is exactly persisted and rendered on-chain
ok 11 - frontend-selected combo is exactly persisted and rendered on-chain
  ---
  duration_ms: 15796.264667
  ...
# Subtest: palette spec has 6 phils and 9 variants each with full slot coverage
not ok 12 - palette spec has 6 phils and 9 variants each with full slot coverage
  ---
  duration_ms: 1.625625
  location: '/Users/tylershome/Library/Mobile Documents/com~apple~CloudDocs/phil_replica_candidate/test/palette-mapping.test.mjs:18:1'
  failureType: 'testCodeFailure'
  error: 'source svg missing mutable color #1a1a2e for phil 0'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///Users/tylershome/Library/Mobile%20Documents/com%7Eapple%7ECloudDocs/phil_replica_candidate/test/palette-mapping.test.mjs:33:14)
    Test.runInAsyncScope (node:async_hooks:206:9)
    Test.run (node:internal/test_runner/test:796:25)
    Test.processPendingSubtests (node:internal/test_runner/test:526:18)
    node:internal/test_runner/harness:255:12
    node:internal/process/task_queues:140:7
    AsyncResource.runInAsyncScope (node:async_hooks:206:9)
    AsyncResource.runMicrotask (node:internal/process/task_queues:137:8)
  ...
# Subtest: variants 1..8 remain phil-specific (no universal palette reuse)
ok 13 - variants 1..8 remain phil-specific (no universal palette reuse)
  ---
  duration_ms: 0.267667
  ...
# Subtest: variant 0 preserves canonical token coverage under deterministic normalization
ok 14 - variant 0 preserves canonical token coverage under deterministic normalization
  ---
  duration_ms: 79.960541
  ...
# Subtest: all 54 base combinations render valid SVG and are deterministic
ok 15 - all 54 base combinations render valid SVG and are deterministic
  ---
  duration_ms: 148.408917
  ...
# Subtest: every phil has at least one custom variant that differs from variant 0
ok 16 - every phil has at least one custom variant that differs from variant 0
  ---
  duration_ms: 11.513125
  ...
# Subtest: mixing is deterministic for same seed and mode
ok 17 - mixing is deterministic for same seed and mode
  ---
  duration_ms: 205.331916
  ...
# Subtest: mixing changes output when seed changes (mix enabled)
ok 18 - mixing changes output when seed changes (mix enabled)
  ---
  duration_ms: 14.527166
  ...
1..18
# tests 18
# suites 0
# pass 17
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 18056.251208
```

Raw logs are preserved at:

- `artifacts/baseline/npm-ci.log`
- `artifacts/baseline/npm-run-compile.log`
- `artifacts/baseline/npm-test.log`

## Current Entrypoints and Key Paths

### Mint + Proof Gate

- Mint contract entrypoint: `contracts/PhilTestMint.sol`
- Proof verification entrypoints: `contracts/ProofGateTest13.sol`
  - `verifyAndConsume(...)`
  - `computeClaimHash(...)`
  - `computeExpectedFactHash(...)`
- Proof payload interface: `contracts/IProofGate.sol`
- Local proof derivation tooling: `shared/proof/localStarkProver.mjs`
- Local proof package script (current): `scripts/proofs/generate_proof_package.mjs`
- 13-mint end-to-end runner: `scripts/test13_e2e.mjs`

### Smart Account

- Account implementation: `contracts/PhilAccount.sol`
- Account factory: `contracts/PhilAccountFactory.sol`
- Local smart-account stack (dev-only):
  - `contracts/LocalSmartAccount.sol`
  - `contracts/LocalSmartAccountFactory.sol`
- Account smoke tests: `test/account.smoke.test.mjs`

### Marketplace Smoke Surface

- Marketplace-related selector gating exists inside: `contracts/PhilAccount.sol` (`_scopeForCall`)
- Marketplace smoke tests: `test/marketplace.smoke.test.mjs`
- ERC721 mint token used in smoke tests: `contracts/PhilTestMint.sol`

### Proof/SHARP Interfaces

- Dev-only SHARP-style registry adapter: `contracts/proofs/DevProofVerifier.sol`
- SHARP fact registry interface: `contracts/proofs/ISharpFactRegistry.sol`
- Cairo source (allowlist): `cairo/src/allowlist.cairo`

## Baseline Summary

- Install: success (`npm ci`)
- Compile: success (`npm run compile`)
- Tests: 17 pass / 1 fail (`test/palette-mapping.test.mjs` mutable color assertion)
