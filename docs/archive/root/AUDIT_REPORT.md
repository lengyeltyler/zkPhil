# philFresh Audit Report

**Date:** 2026-02-18
**Auditor:** Claude Code (Anthropic)
**Repository:** philFresh (local path: `philFresh/`)
**Status:** All existing tests pass (5 test files, 11 test cases)

---

## Table of Contents

1. [Repo Map & Architecture Overview](#1-repo-map--architecture-overview)
2. [Threat Model & Trust Assumptions](#2-threat-model--trust-assumptions)
3. [Determinism Review](#3-determinism-review)
4. [On-Chain Integrity](#4-on-chain-integrity)
5. [Security Review](#5-security-review)
6. [Gas Review](#6-gas-review)
7. [Testing Review](#7-testing-review)
8. [Build & Dependency Review](#8-build--dependency-review)
9. [Action Plan](#9-action-plan)
10. [Do Not Change List](#10-do-not-change-list)

---

## 1. Repo Map & Architecture Overview

### Directory Structure (excluding `.tools/` and `node_modules/`)

```
philFresh/
├── contracts/                   # Solidity contracts
│   ├── PhilTestMint.sol         # ERC721 mint contract (13-supply cap)
│   ├── ProofGateTest13.sol      # Allowlist proof verifier + nullifier burner
│   ├── PhilRenderer.sol         # On-chain SVG renderer (fragments + palettes)
│   ├── PhilFragments.sol        # SSTORE2 fragment registry (66 slots)
│   ├── PhilPalettes.sol         # SSTORE2 palette registry (6 phils x 9 variants)
│   ├── PhilDSLDecoder.sol       # Binary DSL v1/v2 to SVG decoder (library)
│   ├── PhilAccount.sol          # ERC-4337 smart account with scope policy
│   ├── PhilAccountFactory.sol   # CREATE2 smart account factory
│   ├── PhilPaymaster.sol        # ERC-4337 v0.7 verifying paymaster
│   ├── PhilUnlockInbox.sol      # L1 unlock ticket inbox (Starknet messaging)
│   ├── PhilWeb3.sol             # ERC-4804 on-chain SVG gateway
│   ├── IProofGate.sol           # Interface for proof gate
│   ├── SSTORE2Deployer.sol      # Helper for SSTORE2 writes
│   ├── MockSatellite.sol        # Test mock (not for production)
│   └── mocks/                   # Test mocks
├── shared/
│   ├── phil-renderer/
│   │   ├── renderPhil.mjs       # Off-chain renderer (mirrors on-chain logic)
│   │   ├── phil-palettes-v2.json # Canonical palette data (6 phils x 9 variants)
│   │   └── phil-palettes.json   # Legacy palette data (superseded by v2)
│   └── proof/
│       ├── merkle.mjs           # Keccak256 Merkle tree (for allowlist)
│       └── localStarkProver.mjs # Local proof builder (no STARK, deterministic)
├── scripts/
│   ├── fragments/build.mjs      # Build DSL-encoded fragment manifest
│   ├── fragments/deploy.mjs     # Deploy fragments + palettes on-chain
│   ├── local/                   # Local dev scripts (e2e, gas, frontend)
│   └── ...                      # Various utility scripts
├── test/                        # Node.js --test test suite
│   ├── allowlist-proof.contract.test.mjs  # Contract integration test
│   ├── fragments-dsl.test.mjs             # DSL encode/decode tests
│   ├── svg-render.integration.test.mjs   # SVG render determinism tests
│   ├── palette-mapping.test.mjs          # Palette spec validation
│   └── frontend-selection.integration.test.mjs  # Full flow smoke
├── server-ts/src/               # Backend (Fastify + TypeScript + SQLite)
│   ├── index.ts                 # Server entry point
│   ├── routes/requestMint.ts    # Proof serving endpoint
│   ├── routes/signPaymaster.ts  # Paymaster sponsorship signing
│   ├── routes/admin.ts          # Admin proof management
│   ├── routes/computeAccount.ts # Account address derivation
│   ├── lib/db.ts                # SQLite proof store
│   ├── lib/factHash.ts          # Server-side factHash computation
│   ├── lib/merkle.ts            # Pedersen Merkle tree (Cairo-compatible)
│   └── lib/atlantic.ts          # Atlantic API integration
├── cairo/src/                   # Cairo 1 programs
│   ├── lib.cairo                # Cairo entry point
│   └── allowlist.cairo          # Allowlist membership prover
├── Layers/                      # Canonical SVG artwork assets
│   ├── Phil{0..5}.svg           # Canonical full SVGs (DO NOT MODIFY)
│   └── Phil{0..5}/              # Fragment SVG files per slot
├── artifacts/                   # Build outputs (gitignored)
├── hardhat.config.cjs           # Hardhat config (Solidity 0.8.24, viaIR, 200 runs)
└── package.json                 # Root package (ESM, ganache, ethers v6, solady)
```

### Architecture Summary

**Rendering Pipeline:**
```
Layers/Phil{N}.svg (canonical art)
  → scripts/fragments/build.mjs
     → replaceHexColors (color → @XX slot tokens)
     → stripSvgWrapper (extract inner SVG content)
     → encodeDslV2 (optional compression, ~3x savings)
  → artifacts/fragments/build-manifest.json
  → scripts/fragments/deploy.mjs
     → SSTORE2Deployer.write() per chunk
     → PhilFragments(chunks, offsets, dslFlags) constructor
     → PhilPalettes(palettePointers, slotCounts) constructor
  → On-chain: PhilRenderer.renderSvg(philId, paletteVariant, mixMode, mixSeed)
     → reads fragments via SSTORE2.read()
     → decodes DSL if flagged
     → applies palette colors by slot index
     → returns complete SVG string
```

**Proof Pipeline (Local Mode):**
```
allowlist addresses
  → buildMerkleTree() (keccak256-based, standard sorted pairs)
  → merkle root pinned in ProofGateTest13 constructor

For each allowlisted address:
  → computeClaimHash(dropId, chainId, proofGate, recipient, mintTo, ...)
  → computeFactHash(programHash, merkleRoot, claimHash, witnessHash)
  → recipient signs claimHash (EOA ECDSA)
  → MintProof{expiry, factHash, merkleProof, signature}

On mint: ProofGateTest13.verifyAndConsume()
  → verify expiry (if set)
  → MerkleProofLib.verifyCalldata(proof.merkleProof, MERKLE_ROOT, leaf)
  → recompute claimHash, factHash, compare to proof.factHash
  → recover signer from signature, must == recipient
  → nullifier = keccak256(recipient, factHash), must not be used
  → burn nullifier, emit event
```

**Note on "STARK" naming:** The current `ProofGateTest13` is NOT actually verifying STARK proofs from the Atlantic satellite on-chain. Instead it uses a local deterministic scheme: recipient signs a `claimHash` with ECDSA, and a `factHash` is a keccak256 commitment binding the mint intent to the merkle witness. The `server-ts` code has Atlantic integration but the local flow uses `localStarkProver.mjs` which is purely ECDSA-based. The SPEC.md describes the full Atlantic STARK flow as the production target; the current contracts implement a local substitute.

---

## 2. Threat Model & Trust Assumptions

### Trust Hierarchy

| Level | Entity | Trust |
|-------|--------|-------|
| 0 (highest) | Deployed immutable contracts | Fully trusted once deployed |
| 1 | Ethereum chain state | Trusted by EVM consensus |
| 2 | On-chain SVG fragments/palettes | Trusted after SSTORE2 deployment |
| 3 | Backend proof server | Operator-trusted; serves proofs + signs paymaster |
| 4 | Atlantic external proving service | External trust; provides STARK facts |
| 5 | Browser/User device | User-controlled; signs UserOps |

### Trust Boundaries and Attack Surface

**On-chain (immutable after deploy):**
- `ProofGateTest13`: Immutable `PROGRAM_HASH`, `DROP_ID`, `MERKLE_ROOT`, `mintContract`
- `PhilFragments`: Immutable chunk pointers and offset tables
- `PhilPalettes`: Immutable palette pointers

**Mutable on-chain (owner-controlled):**
- `PhilRenderer`: Owner can change `gateway`, `compactTokenURI`
- `PhilTestMint`: Owner can change `royaltyReceiver`, transfer ownership
- `PhilPaymaster`: Owner can deposit/withdraw ETH

**Off-chain dependencies:**
- Backend server: manages proof DB, signs paymaster approvals
- Atlantic API: external STARK prover (for production flow)
- Frontend: no persistent state, reads chain and server

### Key Security Assumptions

1. The `mintContract` immutable correctly gates `verifyAndConsume` to one caller.
2. The merkle root correctly encodes exactly the intended allowlist.
3. Nullifier is unique per `(recipient, factHash)` — factHash is mint-intent-bound.
4. Paymaster signer key is kept secret; compromise enables free-gas abuse within policy.
5. Admin key compromise enables proof injection; nullifier burn on-chain is last-resort protection.
6. `PhilFragments` data is immutable once deployed (SSTORE2 data cannot be overwritten).

---

## 3. Determinism Review

### On-Chain Randomness / Mixing

**Source:** `renderSvg(philId, paletteVariant, mixMode, mixSeed)`
- `mixSeed` is a `uint32` passed at mint time, recorded in contract storage.
- PRNG: XorShift32 (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`)
- If `mixSeed == 0`, a golden seed `0x9e3779b9` is substituted.
- No block hash, block number, or `msg.sender` used in rendering.
- `renderSvg` is a pure `view` function — fully deterministic for fixed inputs.

**Off-chain mirror (`renderPhil.mjs`):** Implements the same XorShift32 and golden seed. Tests confirm parity between off-chain preview and on-chain output.

**Palette mixing modes:**
- `MIX_MODE_NONE (0)`: Identity order, fully deterministic.
- `MIX_MODE_SWAP (1)`: 1–3 swaps based on XorShift32 of seed.
- `MIX_MODE_PERMUTE (2)`: Fisher-Yates shuffle with XorShift32.

**Determinism verdict:** Fully deterministic for fixed `(philId, paletteVariant, mixMode, mixSeed)`. No on-chain entropy sources used in rendering.

### Fragment Encoding Determinism

DSL v2 encoding is deterministic: given the same input string, `encodeDslV2` produces the same byte sequence. The decision to use DSL vs raw is made at build time (`if dslBytes.length + 3 < rawBytes.length`) — this threshold is stable.

### Potential Drift Points

| Risk | Description | Severity |
|------|-------------|----------|
| `compactTokenURI` flag | Owner can toggle between `web3://` and `data:base64` tokenURI modes | Medium — changes tokenURI format but not SVG content |
| `gateway` address change | Changes the `web3://` URL in compact mode | Medium — affects tokenURI in compact mode |
| SVG Layer file changes | If `Layers/Phil*.svg` files change, rebuild would change on-chain data | CRITICAL — do not change layer files |
| `phil-palettes-v2.json` changes | Changes color values deployed on-chain | CRITICAL — do not change palette spec |

---

## 4. On-Chain Integrity

### Is the Art Fully On-Chain?

**Yes, in full-embed mode** (`compactTokenURI = false`):
- Fragment SVG content is stored in SSTORE2 pointers on-chain.
- Palette data (packed `bytes3` colors) is stored in SSTORE2 pointers on-chain.
- `PhilRenderer.renderSvg()` assembles SVG entirely from on-chain reads.
- `tokenURI()` in full-embed mode returns `data:application/json;utf8,...` with base64 SVG.
- No external URLs or IPFS in full-embed mode.

**In compact mode** (`compactTokenURI = true`, default after deploy):
- `tokenURI()` returns a `web3://` URL pointing to `PhilWeb3.read()`.
- `PhilWeb3.read()` calls back into `PhilRenderer.renderSvg()` — still on-chain.
- The `web3://` protocol requires an ERC-4804-compatible gateway to resolve.
- **Finding:** In compact mode, the tokenURI is technically a URL, not embedded data. However, the rendering logic itself remains on-chain and is verifiable. The `web3://` scheme is part of the on-chain NFT ecosystem standard.

### SSTORE2 Storage Safety

- `PhilFragments` stores chunk pointers in an immutable array set at construction time.
- `PhilPalettes` stores palette pointers set at construction time.
- SSTORE2 data is written once and is bytecode — immutable after write.
- `fragmentRange()` returns `(start, end, isDsl)` tuples from packed offset tables.
- Offset monotonicity is validated in the `PhilFragments` constructor.

### Verification Path

Any observer can:
1. Read `PhilFragments.chunkPtr(i)` for all chunks.
2. Read `SSTORE2.read(ptr)` for each chunk.
3. Assemble fragments per `fragmentRange()` offsets.
4. Decode DSL if `isDsl == true`.
5. Read palette data from `PhilPalettes.paletteData(philId)`.
6. Apply palette substitution to reconstruct exact SVG output.

This is fully verifiable without any off-chain dependencies.

---

## 5. Security Review

### 5.1 Authentication & Access Control

| Contract | Function | Access | Finding |
|----------|----------|--------|---------|
| `PhilTestMint` | `mint()` | public | Correctly delegates auth to `ProofGateTest13` |
| `PhilTestMint` | `transferOwnership`, `setRoyaltyReceiver` | `onlyOwner` | Single owner, no multisig |
| `ProofGateTest13` | `verifyAndConsume()` | `if (msg.sender != mintContract)` | Correct; reverts on unauthorized caller |
| `PhilRenderer` | `setGateway`, `setCompactTokenURI`, `transferOwnership` | `onlyOwner` | Single owner |
| `PhilAccount` | `addOwner`, `removeOwner`, etc. | `onlyVaultOwner` | Mapping-based, correct |
| `PhilPaymaster` | `deposit`, `withdraw` | `onlyOwner` | Solady `Ownable`, correct |
| `PhilUnlockInbox` | `recordTicket` | public | Caller-agnostic; requires valid L2 message |

**Finding (Medium):** `PhilTestMint` and `PhilRenderer` have single-owner patterns with no 2-of-N or timelock. Owner compromise allows changing `royaltyReceiver` or toggling `compactTokenURI`. These do not affect on-chain SVG content but could change tokenURI format.

### 5.2 Reentrancy

- `PhilTestMint.mint()`: calls `gate.verifyAndConsume()` before `_mint()`. The gate call is to a trusted immutable address and does not call back into `PhilTestMint`. No ETH transfers in mint flow. **Safe.**
- `PhilPaymaster.deposit()`: sends ETH to `entryPoint` via raw call. No state changes after call. **Safe.**
- `PhilPaymaster.withdraw()`: calls `entryPoint.withdrawTo`. No state changes after. **Safe.**
- `PhilUnlockInbox.recordTicket()`: calls `starknetCore.consumeMessageFromL2()` before state update. **Finding (Low):** The nonce check and state write happen after the external call. An attacker controlling `starknetCore` could potentially manipulate but `starknetCore` is an immutable constructor parameter and should be trusted L1 Starknet core. Still, CEI (Checks-Effects-Interactions) pattern violation is present — state update should happen before external call.

### 5.3 Signature Validation

**`ProofGateTest13`:**
- `claimHash` binds: `DROP_ID`, `block.chainid`, `address(this)` (gate address), `recipient`, `mintTo`, `philId`, `paletteVariant`, `mixMode`, `mixSeed`, `expiry`.
- `factHash` binds: `PROGRAM_HASH`, `claimHash`, `MERKLE_ROOT`, `witnessHash`.
- Signature recovery uses `ECDSA.recoverCalldata(claimHash.toEthSignedMessageHash(), proof.signature)`.
- **Chain ID included** in claimHash: cross-chain replay prevented.
- **Contract address included** in claimHash: cross-gate replay prevented (different deployments have different addresses).
- **Drop ID included**: cross-drop replay prevented.
- **Finding (Low):** `factHash` is also included in the nullifier: `keccak256(recipient, factHash)`. This means changing any mint parameter (philId, palette, etc.) invalidates the nullifier even if recipient is the same. This is correct behavior since factHash commits to the full mint intent.

**`PhilPaymaster`:**
- Hash binds full UserOp fields + `block.chainid` + `address(this)` + validity window.
- Signature by `verifyingSigner` (backend-controlled).
- **Finding (Low):** `verifyingSigner` is immutable — no rotation mechanism. If signer key is compromised, a new paymaster must be deployed.

### 5.4 Merkle Proof Verification

- Uses `solady/MerkleProofLib.verifyCalldata()` — well-audited library.
- Leaf: `keccak256(abi.encodePacked(recipient))` — standard single-value leaf.
- Proof sorting: `hashPair()` in `merkle.mjs` sorts by value, matching standard OpenZeppelin/MerkleProofLib conventions.
- **Finding (Low):** `MerkleProofLib.verifyCalldata` is correct for standard sorted-pair merkle trees. Ensure the off-chain tree builder and on-chain verifier use the same hash ordering — verified: both use `left < right ? sort : ...` style via BigInt comparison and MerkleProofLib's internal sort.

### 5.5 Replay Risks

| Attack Vector | Mitigation | Status |
|--------------|------------|--------|
| Proof replay (same nullifier) | `nullifierUsed[keccak256(recipient, factHash)]` burned on first use | PROTECTED |
| Cross-chain replay | `block.chainid` in claimHash | PROTECTED |
| Cross-gate replay | `address(this)` in claimHash | PROTECTED |
| Cross-drop replay | `DROP_ID` in claimHash | PROTECTED |
| Expiry bypass | `proof.expiry != 0 && block.timestamp > proof.expiry` check | PROTECTED |
| Paymaster replay | Signature commits to full UserOp fields + chain + paymaster address | PROTECTED |
| Ticket nonce replay | `nonce <= prev` in `PhilUnlockInbox.recordTicket()` | PROTECTED |

### 5.6 Storage Collision / Encoding Safety

- `PhilFragments` uses `uint16[67]` for offsets (0..66 inclusive, 67 elements for 66 fragments + sentinel).
- Offset monotonicity validated in constructor.
- `_dslFlags[i] == 0 ? 0 : 1` normalization prevents flag pollution.
- **Finding (Low):** `PhilFragments` uses `uint16` for chunk count. With max 65535 chunks, this is generous but could theoretically overflow if fragment count is very large. Current fragment count is ~66 (6 phils × 11 slots), each potentially split into multiple 24kB chunks. With ~100kB max fragment, ~5 chunks each → well within bounds.

### 5.7 Critical Security Finding: Secrets Committed to `.env`

**CRITICAL:** The `.env` file contains what appears to be a real private key and Infura API key:
```
RPC_URL=https://sepolia.infura.io/v3/3636868543c14064a73d249d3af3794d
PRIVATE_KEY=0x9314621261dd7e44e1697a0468011af24df3aeeb216b6a8725d332899c1056f9
```

The `.gitignore` correctly lists `.env`, but the file exists locally and contains sensitive values. If this repository is ever pushed to a remote, these secrets would be exposed.

**Action required:**
1. Consider this private key potentially compromised if it was ever used on mainnet/sepolia.
2. Add a `.env.example` with placeholder values only.
3. Never commit `.env` to version control.

### 5.8 PhilPaymaster Policy Ordering Bug

**Finding (Medium):** In `validatePaymasterUserOp`, the signature check and policy check are in the wrong order:

```solidity
// First: policy check
if (!_isSponsoredMint(userOp)) {
    return ("", _packValidationData(true, validUntil, validAfter));
}
// Then: signature check
if (recovered != verifyingSigner) {
    return ("", _packValidationData(true, validUntil, validAfter));
}
```

The signature is recovered **before** the policy check, but the policy check is evaluated first in the return logic. This is harmless in practice (both failure cases return `sigFailed=true`), but the logical intent is that policy should be checked only after signature is verified. More importantly, a valid signature on an invalid policy UserOp still "wastes" gas to run the signature check. This is a defense-in-depth concern only.

### 5.9 PhilAccountFactory: Unchecked initVaultConfig

**Finding (Medium):** In `createPhilAccount()`, the `initVaultConfig` call result is checked (`if (success)`), but failure is silently ignored — no event, no revert. If `initVaultConfig` fails for any reason (other than "already set"), the account will be deployed without vault configuration.

```solidity
(success,) = account.call(
    abi.encodeWithSignature("initVaultConfig(address,address)", ...)
);
if (success) {
    emit PhilAccountCreated(account, owner, starkPubKeyX);
}
// No revert if !success
```

The guard in `PhilAccount.initVaultConfig()` (`require(unlockInbox == address(0))`) means the second call silently no-ops. This is correct for idempotency but the factory's silent failure on first-call failure is a latent risk.

---

## 6. Gas Review

### High-Level Gas Observations

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| `PhilFragments` constructor | ~5–20M gas | Depends on total chunk count; constructor iterates all chunks |
| `SSTORE2.write()` per chunk | ~50k–200k | Per 24kB chunk; ~5 chunks per fragment slot |
| `PhilRenderer.renderSvg()` | ~500k–2M | Reads all SSTORE2 chunks, decodes DSL, applies palette |
| `PhilTestMint.mint()` | ~300k–600k | Proof verification + nullifier write + ERC721 mint |
| `ProofGateTest13.verifyAndConsume()` | ~100k–200k | ECDSA recovery + Merkle proof + nullifier write |

### Safe Gas Optimizations

1. **`_concatBytes` in PhilRenderer**: Double-loop concatenation is O(n) per part but allocates a temporary `bytes[]`. Could use `abi.encodePacked` with assembly for a minor improvement. **Risk: none** (pure view, output unchanged).

2. **`_fragmentData` reads**: Reads all chunk parts into `bytes[]` then concatenates. Could be streaming but would require more complex assembly. Current approach is readable and correct.

3. **`_applyPalette` output buffer**: Over-allocates (`source.length * 3 + 16`) then truncates with assembly. This is correct and efficient.

4. **`PhilDSLDecoder._decodeV1`**: Over-allocates `dsl.length * 12` then truncates. This is safe but conservative — DSL v2 is preferred for new fragments.

### Gas Finding

**Finding (Low):** `PhilRenderer._fragmentData()` creates a `bytes[]` array then concatenates. For large fragments with many chunks, this creates memory pressure. The `_concatBytes` helper is O(total_bytes) which is acceptable.

---

## 7. Testing Review

### Existing Tests

| Test File | What it Covers | Status |
|-----------|---------------|--------|
| `test/fragments-dsl.test.mjs` | DSL v2 encode/decode roundtrip; all DSL fragments decode correctly | ✅ Pass |
| `test/svg-render.integration.test.mjs` | 54 (6×9) SVG combinations; determinism; mixing; palette variants | ✅ Pass |
| `test/palette-mapping.test.mjs` | Palette spec structure; 9 variants per phil; slot coverage | ✅ Pass |
| `test/allowlist-proof.contract.test.mjs` | Contract integration: deploy, valid mint, nullifier replay, outsider rejection, forged sig rejection | ✅ Pass |
| `test/frontend-selection.integration.test.mjs` | Full flow: deploy contracts, render SVG, verify on-chain matches off-chain | ✅ Pass |

### Missing Tests (Recommended)

1. **Supply cap enforcement:** No test verifying `SoldOut()` revert at `totalSupply >= 13`.
2. **`philId >= 6` revert:** No test for `BadPhilId()` in `PhilTestMint`.
3. **`paletteVariant >= 9` revert:** No test for `BadPaletteVariant()`.
4. **`mixMode > 2` revert:** No test for `BadMixMode()`.
5. **Expiry enforcement:** No test verifying `ProofExpired()` revert when `expiry < block.timestamp`.
6. **`UnauthorizedCaller` for gate:** No test calling `verifyAndConsume` directly (not via mint).
7. **Paymaster policy enforcement:** No test for `_sponsorshipCheckReason` failure codes.
8. **`PhilAccount` scope policy tests:** Not covered in existing tests.
9. **`PhilUnlockInbox` nonce monotonicity:** No test for replay prevention.
10. **`PhilRenderer.renderHash()`:** No snapshot test for hash stability.
11. **tokenURI snapshot tests:** No test for exact tokenURI output string matching a golden snapshot.
12. **Compact vs full tokenURI mode:** No test comparing both modes.

### Test Coverage Gaps (Security-Critical)

- **No test for `InvalidRecipient` / `InvalidMintTo`** zero address checks in `PhilTestMint.mint()`.
- **No test for cross-chain replay** (would require two chain IDs in test).
- **No test for maximal supply** with 13 distinct recipients.
- **No test for `MintProof.factHash` tampering** while keeping valid Merkle proof — test exists for wrong factHash, but not for subtle component changes.

---

## 8. Build & Dependency Review

### Package Versions (root `package.json`)

| Package | Version Spec | Risk |
|---------|-------------|------|
| `ethers` | `^6.11.0` | Medium — minor semver range; pin to exact |
| `ganache` | `^7.9.2` | Low — test-only |
| `hardhat` | `^2.22.0` | Medium — build tool, pin |
| `solady` | `^0.0.281` | **High** — core Solidity library with `^` range; pin to exact |
| `starknet` | `^9.2.1` | Medium — proof system integration |
| `svgo` | `^4.0.0` | Low — SVG optimization tool, not in critical path |
| `vite` | `^7.1.7` | Low — frontend dev only |
| `react/react-dom` | `^19.2.0` | Low — frontend dev only |

**Critical Finding (High):** `solady` is imported with `^0.0.281`. Solady is a security-critical library (ECDSA, MerkleProofLib, SSTORE2, ERC721, ERC4337). A major-version change or patch with breaking security changes could silently affect production builds if `npm install` is run again. Pin to `0.0.281` exactly.

**Finding (High):** No `engines` field in `package.json` specifying the required Node.js version. The bundled `.tools/node-v18.20.4-darwin-arm64` is Node 18.20.4, but the system uses v20.20.0. Node 20 is fine for this project but the mismatch should be documented.

### Lockfile

- Root `package-lock.json` exists: good.
- `server-ts/package-lock.json` exists: good.
- However, `^` ranges in `package.json` mean `npm ci` on a fresh install will still use the pinned lockfile versions. The risk is if someone runs `npm install` instead of `npm ci`, they might get newer versions.

### Supply Chain Risk

- `solady` NPM package (`^0.0.281`): Used for `SSTORE2`, `ECDSA`, `MerkleProofLib`, `ERC721`, `ERC4337`, `ERC4337Factory`, `Ownable`, `Base64`, `LibString`. A malicious update to the npm package or a path-traversal could affect compilation. **Recommendation:** Lock solady to exact version and verify via `npm ci`.

### Reproducibility

- No `Makefile` or `justfile` for one-command builds.
- Hardhat compilation is not deterministic across OS/compiler versions (Solidity bytecode may vary with optimizer settings, though `viaIR=true` with 200 runs is stable).
- Build manifest (`artifacts/fragments/build-manifest.json`) includes `generatedAt` timestamp — breaks reproducibility for exact manifest comparison. **Recommendation:** Remove or make optional.

---

## 9. Action Plan

### Critical

| ID | Finding | File | Action |
|----|---------|------|--------|
| C1 | Real private key and API key in `.env` file | `.env` | Rotate key immediately if used on any live network; add `.env.example`; document that `.env` must never be committed |
| C2 | `solady` dependency not pinned to exact version | `package.json` | Change `"solady": "^0.0.281"` to `"solady": "0.0.281"` |

### High

| ID | Finding | File | Action |
|----|---------|------|--------|
| H1 | `ethers`, `hardhat` not pinned to exact versions | `package.json` | Pin all prod and build-critical dependencies to exact versions |
| H2 | No supply cap test | test/ | Add test: mint 13 tokens, verify 14th fails with `SoldOut()` |
| H3 | No tokenURI golden snapshot test | test/ | Add snapshot test: for fixed philId/palette/mixMode/mixSeed, tokenURI must match recorded golden string |
| H4 | `compactTokenURI=true` default with mutable `gateway` | `PhilRenderer.sol` | Document that changing `gateway` or `compactTokenURI` changes tokenURI output; consider making one or both immutable |

### Medium

| ID | Finding | File | Action |
|----|---------|------|--------|
| M1 | `PhilPaymaster` signature/policy check ordering | `PhilPaymaster.sol` | Reorder: verify signature before policy check (defense-in-depth) |
| M2 | `PhilAccountFactory.createPhilAccount()` silently fails on `initVaultConfig` failure | `PhilAccountFactory.sol` | Add revert or emit on first-call failure |
| M3 | `PhilUnlockInbox.recordTicket()` CEI violation | `PhilUnlockInbox.sol` | Move nonce check and state update before `consumeMessageFromL2` call (or document the trust assumption on starknetCore) |
| M4 | No `engines` field in `package.json` | `package.json` | Add `"engines": {"node": ">=18.20.0"}` |
| M5 | Build manifest includes timestamp (breaks reproducibility) | `scripts/fragments/build.mjs` | Make timestamp optional or omit from hash-sensitive outputs |
| M6 | `verifyingSigner` in Paymaster is immutable — no rotation | `PhilPaymaster.sol` | Document rotation process (deploy new paymaster, update backend) |
| M7 | Single-owner on `PhilTestMint` and `PhilRenderer` | Both | Document; consider 2-of-N multisig for production owner |

### Low

| ID | Finding | File | Action |
|----|---------|------|--------|
| L1 | Missing tests for error cases (SoldOut, BadPhilId, Expired, etc.) | test/ | Add targeted error case tests |
| L2 | `phil-palettes.json` (legacy) still present alongside v2 | `shared/phil-renderer/` | Document that v1 is superseded; consider removing |
| L3 | `_deployProxy` in factory has no return address zero-check beyond `revert AccountDeployFailed()` | `PhilAccountFactory.sol` | Already handled; document |
| L4 | `PhilWeb3._parseUint` does not handle overflow | `PhilWeb3.sol` | For on-chain use, `uint256` overflow would revert by Solidity 0.8 arithmetic — safe, but document |
| L5 | `REUSE_STARK_DEPLOYMENTS=true` in `.env` with public Satellite address | `.env` | Document that satellite address is testnet; don't share across deployments without re-verification |
| L6 | No `SECURITY.md` | root | Add minimal security contact/disclosure policy |
| L7 | No `REPRODUCIBILITY.md` | root | Add exact steps to rebuild, verify, and deploy locally from scratch |

---

## 10. "Do Not Change" List

The following are **sacred zones** — any modification risks changing the art output, proof semantics, or on-chain integrity. Do not change without equivalence proof and tests.

### Art Output (DO NOT CHANGE without equivalence proof)

1. **`Layers/Phil{0..5}.svg`** — Canonical layer files. Any change changes the fragment dataset, changes the on-chain content, changes all rendered SVG outputs.

2. **`Layers/Phil{0..5}/*.svg`** — Per-slot fragment files. Same concern.

3. **`shared/phil-renderer/phil-palettes-v2.json`** — Palette color values. Any change changes the palette bytes deployed on-chain, changes all rendered outputs for all phils and variants.

4. **`shared/phil-renderer/renderPhil.mjs`** — The XorShift32 PRNG, mixing logic, slot token format (`@XX`), DSL v2 dictionary, and `buildMixedSlotOrder`. These must stay byte-for-byte identical to `PhilRenderer.sol`.

5. **`contracts/PhilRenderer.sol`** — `_buildMixedOrder`, `_applyPalette`, `_tryParseSlotToken`, `_nextRand`, `GOLDEN_MIX_SEED`. Any change to these changes SVG output.

6. **`contracts/PhilDSLDecoder.sol`** — The complete DSL dictionary, opcode format, and encoding. Any change invalidates all DSL-encoded on-chain fragments.

### Proof Semantics (DO NOT CHANGE without re-deployment)

7. **`ProofGateTest13.computeClaimHash()`** — Inputs and encoding order. Any change breaks all existing mint proofs.

8. **`ProofGateTest13.computeExpectedFactHash()`** — The `witnessHash` construction and ABI encoding. Must match `localStarkProver.mjs` and server-side computation exactly.

9. **`shared/proof/merkle.mjs`** — `hashPair()`, `buildMerkleTree()`, `leafForAddress()`. Any change invalidates the merkle root and all existing proofs.

10. **`shared/proof/localStarkProver.mjs`** — `computeClaimHash()`, `computeFactHash()`. Must stay in parity with `ProofGateTest13.sol`.

### Storage & Encoding (DO NOT CHANGE post-deployment)

11. **`PhilFragments` constructor parameter formats** — `chunks[]`, `uint16[67] offsets`, `uint8[66] dslFlags`. The packed encoding format must match `PhilRenderer._fragmentData()`.

12. **`PhilPalettes` color packing** — `buildPackedPaletteBytes()` output format (9 variants × slotCount × 3 bytes per color). Must match `PhilRenderer._applyPalette()` color offset formula.

13. **`IProofGate.MintProof` struct layout** — Any ABI change breaks all frontend integrations.

### Nullifier Semantics (DO NOT CHANGE)

14. **`nullifier = keccak256(abi.encodePacked(recipient, proof.factHash))`** — This is the nullifier burn key. Changing the formula invalidates all existing nullifier state.

---

## Appendix: Test Run Summary

```
test/fragments-dsl.test.mjs         → 2 tests PASS
test/svg-render.integration.test.mjs → 5 tests PASS
test/palette-mapping.test.mjs       → 2 tests PASS
test/allowlist-proof.contract.test.mjs → 1 test PASS
test/frontend-selection.integration.test.mjs → 1 test PASS
Total: 11 tests, 0 failures
```

---

*End of Audit Report*
