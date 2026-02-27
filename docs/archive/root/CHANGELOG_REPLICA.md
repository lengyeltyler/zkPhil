# Changelog — phil_replica_audit

This file documents all changes made in `phil_replica_audit` relative to the original `philFresh` repository.
Every change is categorized by risk and includes a justification.

---

## Summary

**Zero art-output changes. Zero proof-semantic changes. Zero cryptographic changes.**

All modifications are limited to: dependency pinning, secret handling, test additions, documentation, and `.gitignore` hardening.

---

## Changes

### 1. Dependency Pinning (package.json)

**Risk:** Low (no behavior change)
**Category:** Build reproducibility

**Before:**
```json
"dependencies": {
  "ethers": "^6.11.0",
  "ganache": "^7.9.2",
  "react": "^19.2.0",
  "react-dom": "^19.2.0",
  "solady": "^0.0.281",
  "starknet": "^9.2.1"
},
"devDependencies": {
  "@vitejs/plugin-react": "^5.1.0",
  "dotenv": "^16.4.0",
  "hardhat": "^2.22.0",
  "svgo": "^4.0.0",
  "vite": "^7.1.7"
}
```

**After:** All `^` ranges replaced with exact versions from the existing `package-lock.json`:
```json
"dependencies": {
  "ethers": "6.16.0",
  "ganache": "7.9.2",
  "react": "19.2.4",
  "react-dom": "19.2.4",
  "solady": "0.0.281",
  "starknet": "9.2.1"
},
"devDependencies": {
  "@vitejs/plugin-react": "5.1.4",
  "dotenv": "16.6.1",
  "hardhat": "2.28.4",
  "svgo": "4.0.0",
  "vite": "7.3.1"
}
```

**Justification:** Exact version pins prevent silent upgrades of security-critical libraries (especially `solady` which is used for `SSTORE2`, `ECDSA`, `MerkleProofLib`, `ERC721`, `ERC4337`). The pinned versions match what was already locked in `package-lock.json`, so `npm ci` behavior is unchanged. Only `npm install` behavior changes (now guaranteed to use the exact version).

**Equivalence impact:** None. Same code, same behavior.

---

### 2. `engines` Field Added (package.json)

**Risk:** None (informational only)
**Category:** Developer UX / reproducibility

```json
"engines": {
  "node": ">=18.20.0"
}
```

**Justification:** Documents the minimum Node.js version requirement. The project includes a bundled Node 18.20.4 binary in `.tools/` and ships with a `package-lock.json` generated under Node 18/20. Without an `engines` field, running under an older Node version may silently fail with cryptic errors.

**Equivalence impact:** None.

---

### 3. New npm Scripts Added (package.json)

**Risk:** None
**Category:** Developer UX

Added:
- `"test:equivalence"`: runs equivalence snapshot tests only
- `"test:errors"`: runs error-case contract tests only
- `"audit"`: fast audit subset (palette + DSL + SVG + equivalence tests)

Modified `"test"` to include the two new test files:
```
test/equivalence-snapshots.test.mjs test/error-cases.contract.test.mjs
```

**Equivalence impact:** None. No production code changed.

---

### 4. `.env.example` Added

**Risk:** None
**Category:** Secret management / security

Added `phil_replica_audit/.env.example` with placeholder values and comments explaining:
- What each variable does
- That `.env` must never be committed
- That `PRIVATE_KEY` shown is the Hardhat default (safe for local dev only)
- That Infura/Alchemy URLs should not be used in production

The original `philFresh/.env` contains what appear to be real API keys and a private key. These are not replicated in the replica — the replica has no `.env` file (as required by `.gitignore`).

**Equivalence impact:** None. `.env` is never imported by test or production code directly (loaded by `dotenv` in `hardhat.config.cjs`).

---

### 5. `.gitignore` Hardened

**Risk:** None
**Category:** Secret management

Added entries:
```
*.db
*.db-shm
*.db-wal
.tools/
test/snapshots/*.actual.json
```

**Justification:**
- `*.db` files: prevents accidental commit of SQLite proof database from `server-ts/`
- `.tools/`: the bundled Node.js binary is large and should not be committed
- `*.actual.json`: future snapshot test actual outputs should not be committed

**Equivalence impact:** None.

---

### 6. New Test: `test/equivalence-snapshots.test.mjs`

**Risk:** None (additive test)
**Category:** Equivalence verification

Six new test cases:
1. **SVG render hash check** — `renderPhil()` output SHA-256 matches golden for 7 fixed vectors
2. **Slot order check** — `buildMixedSlotOrder()` output matches golden for 72 vectors (6 phils × 2 modes × 6 seeds)
3. **Palette bytes check** — `buildPackedPaletteBytes()` SHA-256 matches golden for all 6 phils
4. **Merkle tree check** — root, leaves, and 2 proofs match golden for fixed address set
5. **Proof hash check** — `computeClaimHash()` and `computeFactHash()` match golden for 3 addresses
6. **DSL stability check** — all DSL fragments decode correctly and re-encode to identical bytes

**Golden snapshot:** `test/snapshots/golden.json` generated from the original `philFresh` repo.
**Generator:** `test/snapshots/gen_golden.mjs` (identical copy from original repo).

All 6 tests pass in both the original and the replica.

**Equivalence impact:** This test *proves* the replica outputs are identical. If any test fails, the replica has diverged in a way that would change on-chain behavior.

---

### 7. New Test: `test/error-cases.contract.test.mjs`

**Risk:** None (additive test)
**Category:** Security coverage

One contract integration test with multiple assertions covering error revert paths:
- `BadPhilId()` — `philId >= 6`
- `BadPaletteVariant()` — `paletteVariant >= 9`
- `BadMixMode()` — `mixMode > 2`
- `ProofExpired()` — expiry in the past
- `UnauthorizedCaller()` — direct gate call bypassing mint
- `SoldOut()` — 14th mint after supply cap of 13
- Supply stays at 13 after failed 14th mint

Deploys full contract stack on an in-process ganache node (no external network).

**Equivalence impact:** Test-only. No production code changed.

---

### 8. `SECURITY.md` Added

**Risk:** None
**Category:** Documentation

Documents security contact process, trust model, key rotation procedures, and scope.

**Equivalence impact:** None.

---

### 9. `REPRODUCIBILITY.md` Added

**Risk:** None
**Category:** Documentation

Documents exact steps to:
- Set up the project from scratch
- Run tests without external dependencies
- Build the fragment manifest
- Verify fragment build determinism
- Deploy locally with a self-hosted node
- Verify on-chain output without external services

**Equivalence impact:** None.

---

### 10. `AUDIT_REPORT.md` Added (both repos)

**Risk:** None
**Category:** Documentation

Comprehensive security and architecture audit report. Added to both the original and replica repos.

**Equivalence impact:** None.

---

## What Was NOT Changed (and Why)

| Component | Reason Not Changed |
|-----------|-------------------|
| All Solidity contracts (`contracts/`) | Any change risks behavior change; no changes are safe without full re-audit and re-deployment |
| `shared/phil-renderer/renderPhil.mjs` | Sacred zone — changes art output; verified equivalent via snapshot tests |
| `shared/phil-renderer/phil-palettes-v2.json` | Sacred zone — changes palette deployment data |
| `shared/proof/merkle.mjs` | Changes proof semantics; tested via snapshot |
| `shared/proof/localStarkProver.mjs` | Changes proof semantics; tested via snapshot |
| `Layers/` SVG files | Sacred zone — changes art content |
| `scripts/fragments/build.mjs` | Changes fragment encoding logic; not touched |
| All existing test files | Left untouched to preserve original test baseline |
| `hardhat.config.cjs` | Compiler settings affect bytecode; no changes |
| `package-lock.json` | Not regenerated; `npm ci` uses original lockfile |
| `server-ts/` | Backend code; not changed |
| `cairo/` | Cairo program source; not changed |

---

## Audit Trail

| Change | Reversible? | Output-changing? |
|--------|-------------|------------------|
| Dependency pinning | Yes (revert package.json) | No |
| `engines` field | Yes | No |
| New npm scripts | Yes | No |
| `.env.example` | Yes | No |
| `.gitignore` additions | Yes | No |
| New equivalence tests | Yes | No — only verify |
| New error-case tests | Yes | No — only verify |
| Documentation files | Yes | No |
