# Phil System — Full Architectural Audit Report (V2)

**Date:** 2026-02-23
**Auditor:** Senior Smart Contract Security Engineer / On-Chain Generative Art Systems Architect
**Replica Target:** `phil_replica_candidate/`
**Audit Scope:** All Solidity contracts, Cairo programs, off-chain renderer, proof system, frontend, scripts, server, and build tooling.
**Status:** Replica created and verified. Audit complete. Mainnet-bound review.

---

## PHASE 1 — REPLICA CREATION CONFIRMATION

**Replica created at:** `/phil_replica_candidate/`

**File Count Comparison (excluding node_modules, artifacts, cache, dist, .claude):**

| Category | Source | Replica | Match |
|---|---|---|---|
| Files | 204 | 204 | YES |
| Contracts (.sol) | 22 | 22 | YES |
| SVG layers | 54 | 54 | YES |
| Directories (excl. generated) | 41 | 41 | YES |

**Excluded from replica (correct):**
- `node_modules/` — regeneratable via `npm ci`
- `server-ts/node_modules/` — same
- `server-ts/dist/` — compiled TypeScript output (regeneratable)
- `artifacts/`, `cache/` — Hardhat build outputs (regeneratable)
- `.claude/` — local session state, not project code

**Symlink check:** No symlinks present in replica.

**Environment files:** `.env.example` and `.gitignore` both present. No `.env` file copied (correct — `.env` is in `.gitignore` and was not present in the rsync transfer).

**Structural match:** All subdirectories match exactly — `contracts/`, `scripts/`, `test/`, `cairo/`, `shared/`, `sharpAccountV1/`, `frontend/`, `server-ts/src/`, `Layers/`, `docs/`.

---

## PHASE 2 — FULL STRUCTURAL AUDIT

---

### A. HIGH-LEVEL ARCHITECTURE MAP

#### Contract Roles

```
contracts/
├── PhilTestMint.sol           ERC721. 13-supply cap. Delegates mint auth to ProofGate.
│                              Stores per-token (philId, paletteVariant, mixMode, mixSeed).
│                              Calls renderer.tokenURI() for metadata.
│
├── ProofGateTest13.sol        Proof gate. Immutable PROGRAM_HASH, DROP_ID, MERKLE_ROOT,
│                              mintContract. Verifies Merkle inclusion, ECDSA signature,
│                              fact hash commitment, expiry, and nullifier. Burns nullifier.
│
├── PhilRenderer.sol           On-chain SVG assembler. Reads fragments from SSTORE2 via
│                              PhilFragments, reads palette data via PhilPalettes, applies
│                              slot-based color substitution, decodes DSL if flagged,
│                              applies XorShift32 palette mixing. Produces full SVG string.
│                              Produces tokenURI (data: or web3:// depending on mode).
│
├── PhilFragments.sol          Fragment registry. Constructor-initialized. Immutable after
│                              deploy. Stores SSTORE2 pointer arrays and offset tables for
│                              6 phils × 11 slots = 66 fragments, each mapping to a range
│                              of chunk pointers. DSL flags per fragment.
│
├── PhilPalettes.sol           Palette registry. Constructor-initialized. Immutable after
│                              deploy. 6 phils, each with 1 SSTORE2 blob of packed bytes3
│                              colors (9 variants × slotCount × 3 bytes per color).
│
├── PhilDSLDecoder.sol         Library. Decodes binary DSL v1 and v2 to SVG string.
│                              V1: geometric opcodes (ellipse, circle, triangle, hexagon).
│                              V2: literal + dictionary compression with 43-token dict.
│
├── PhilAccount.sol            ERC-4337 smart account. Multi-owner mapping. Scope-based
│                              policy engine. STARK unlock ticket gating for sensitive ops
│                              (transfer, approval, listing, large spend, owner change,
│                              upgrade). Deferred unlock via PhilUnlockInbox.
│
├── PhilAccountFactory.sol     CREATE2 factory for PhilAccount. Salt = (owner_addr << 96)
│                              | truncated_hash(starkPubKeyX). Calls initVaultConfig
│                              on first deployment.
│
├── PhilPaymaster.sol          ERC-4337 v0.7 verifying paymaster. Signs sponsorship per
│                              UserOp. Restricts sponsorship to mint calls on PhilTestMint.
│                              Backend-signed validity window.
│
├── PhilWeb3.sol               ERC-4804 gateway. Handles web3:// paths to renderSvg().
│                              Supports /svg/<philId>/<paletteVariant>[/<mixMode>/<mixSeed>].
│
├── SSTORE2Deployer.sol        Utility. write()/read() wrapper for SSTORE2 chunked storage.
│
├── IProofGate.sol             Interface. MintProof struct + verifyAndConsume() + nullifierUsed().
│
├── IAtlanticSatellite.sol     Interface. isValid(bytes32 factHash) → bool.
│                              Production target: Herodotus Atlantic fact registry.
│
├── LocalSmartAccount.sol      Dev-only. Minimal single-owner account for local flows.
│
├── LocalSmartAccountFactory.sol Dev-only. CREATE2 factory for LocalSmartAccount.
│
├── MockSatellite.sol          Test-only. Configurable acceptAll or per-fact registry.
│
├── EntryPointLocalMock.sol    Test-only. Minimal ERC-4337 EntryPoint for local AA testing.
│
├── ProofGateTest13.sol        Production proof gate. (see above)
│
├── interfaces/IERC4804.sol    Interface stub for ERC-4804.
│
├── mocks/DeployAndMintHelper.sol  Test helper. Deploys account + mints in one tx.
│                                  NOTE: Uses stale mint interface (see findings).
│
├── mocks/MockAccountOwner.sol     Test mock for account ownership.
│
└── mocks/MockRenderer.sol         Test mock renderer. Returns static tokenURI.
                                   NOTE: Uses stale interface signature (see findings).
```

#### Proof Flow (Local Dev Mode vs Production Target)

**Production target (Atlantic STARK):**
```
Operator generates secrets → builds Merkle tree → PROGRAM_HASH pinned in ProofGateTest13
Atlantic proves Cairo program (allowlist.cairo) for each secret
→ outputs [root, drop_id, recipient, nullifier, leaf, idx]
→ factHash = keccak256(abi.encode(PROGRAM_HASH, keccak256(abi.encodePacked(outputs))))
→ Atlantic registers factHash with Herodotus Satellite contract
→ On mint: ProofGateTest13 calls IAtlanticSatellite.isValid(factHash)
```

**Current local dev mode (ProofGateTest13 actual implementation):**
```
NOTE: ProofGateTest13 does NOT call IAtlanticSatellite.isValid() at all.
      It uses a local deterministic scheme:
      1. MerkleProofLib.verifyCalldata(merkleProof, MERKLE_ROOT, leaf)
      2. Recomputes claimHash and factHash on-chain, compares to proof.factHash
      3. ECDSA.recoverCalldata(claimHash.toEthSignedMessageHash(), signature) == recipient
      4. Nullifier burn
This means the "STARK proof" in local mode is purely ECDSA + Merkle + keccak256 commitment.
The IAtlanticSatellite interface is present but NOT USED by ProofGateTest13.
This is the single most important architectural gap for mainnet.
```

#### Account Abstraction Components

```
PhilAccountFactory (CREATE2)
  → deploys PhilAccount proxy via minimal ERC-1167 clone
  → calls initialize(owner) + initVaultConfig(unlockInbox, philTestMint)

PhilAccount (ERC-4337 via Solady ERC4337 base)
  → _validateSignature: ECDSA recovery against isOwner mapping
  → _enforceUserOpPolicy: decodes callData, enforces scope policy
  → execute / executeBatch: enforces scope policy per call
  → Unlock tickets: reads from PhilUnlockInbox for STARK-gated scopes

PhilPaymaster (ERC-4337 verifying paymaster)
  → validatePaymasterUserOp: signature + policy check
  → Restricts sponsorship to mint() calls on PhilTestMint

EntryPointLocalMock (local dev only)
  → Minimal v0.7 EntryPoint at fixed address 0x1000...0001
  → Not production-grade
```

#### Rendering Pipeline

```
Off-chain build:
Layers/Phil{N}/{slot}.svg
  → scripts/strip_optimize_svgs.mjs (SVGO optimize)
  → shared/phil-renderer/renderPhil.mjs (color → @XX slot tokens)
  → scripts/svg-to-dsl.mjs (optionally encode to binary DSL v2)
  → scripts/fragments/build.mjs (assemble build-manifest.json)
  → scripts/fragments/deploy.mjs
      → SSTORE2Deployer.write(chunk) for each 24kB chunk
      → PhilFragments(chunks[], offsets[], dslFlags[]) constructor
      → PhilPalettes(palettePointers[], slotCounts[]) constructor
      → PhilRenderer(fragments, palettes, gateway) constructor
      → PhilWeb3(renderer) constructor

On-chain render (PhilRenderer.renderSvg):
  → palettes.palettePointer(philId) → SSTORE2.read() → paletteData
  → _buildMixedOrder(slotCount, mixMode, mixSeed) → XorShift32 permutation
  → For each slot (0..10):
      → fragments.fragmentRange(philId, slot) → (start, end, isDsl)
      → For chunk in [start, end):
          → fragments.chunkPtr(i) → SSTORE2.read()
      → Concat chunks → fragmentData
      → if isDsl: PhilDSLDecoder.decode(fragmentData) → SVG string
      → _applyPalette(fragmentData, paletteData, slotCount, paletteVariant, mixedOrder)
          → scan for @XX slot tokens → replace with #RRGGBB hex
  → Concat all slot segments + SVG wrapper → full SVG
```

#### Trait Storage Architecture

```
PhilFragments: uint16[67] offsets (monotonic), address[] chunks (SSTORE2 ptrs),
               uint8[66] dslFlags. Fixed at construction. 66 fragment slots = 6×11.
               Each fragment = range [start, end) of chunk pointers.

PhilPalettes: address[6] palettePointers, uint8[6] slotCounts.
              Each pointer → SSTORE2 blob of packed bytes3 colors.
              Layout: [palette0_slot0..palette0_slotN][palette1_slot0..] × 9 palettes.

On-chain slot token format: @XX (3 bytes: 0x40, hex digit, hex digit).
Palette color substitution: slot → mixedOrder[slot] → colorOffset in paletteData.
Color offset: (paletteVariant × slotCount + mixedOrder[slot]) × 3.
```

#### Mint Flow

```
User → Frontend
  → wallet connect (MetaMask)
  → computeAccount: factory.getPhilAddress(owner, starkPubKeyX)
  → server /request-mint → returns MintProof (expiry, factHash, merkleProof, signature)
  → buildMintUserOp: encodes mint() in execute() wrapper
  → server /sign-paymaster → returns paymasterAndData
  → signUserOp: EOA signs userOpHash
  → sendUserOp: submits to bundler (or EntryPointLocalMock.handleOps locally)

EntryPoint.handleOps:
  → PhilAccountFactory.createPhilAccount (if not deployed, via initCode)
  → PhilAccount._validateSignature (ECDSA, owner check)
  → PhilPaymaster.validatePaymasterUserOp (sig + policy)
  → PhilAccount.execute(PhilTestMint, 0, mintCalldata)
  → PhilTestMint.mint(recipient, mintTo, philId, paletteVariant, mixMode, mixSeed, proof)
  → ProofGateTest13.verifyAndConsume(...)
  → _mint(mintTo, tokenId) [Solady ERC721]
  → emit PhilMinted
```

#### Off-Chain Dependency Points

```
CRITICAL OFF-CHAIN DEPENDENCIES:
1. Backend proof server (Fastify + TypeScript + SQLite)
   - Stores and serves MintProof per (recipient, dropId)
   - Signs paymaster approvals (verifyingSigner key)
   - Admin endpoints for proof management

2. Atlantic API (Herodotus) [PRODUCTION ONLY — not used in local dev]
   - Submits Cairo program + inputs for STARK proving
   - Registers factHash on Atlantic Satellite (IAtlanticSatellite)
   - NOT called by ProofGateTest13 in current implementation

3. Bundler / EntryPoint
   - Local: EntryPointLocalMock at 0x1000...0001
   - Production: ERC-4337 v0.7 canonical EntryPoint

4. ERC-4804 gateway (for web3:// tokenURI resolution)
   - Required for compact tokenURI mode
   - PhilWeb3.sol is the on-chain component
   - Resolution requires a compatible web3:// client

5. Starknet L1 messaging (PhilUnlockInbox)
   - StarknetCore.consumeMessageFromL2() for unlock tickets
   - Requires active Starknet L1 core contract
```

---

### B. EXECUTION FLOW ANALYSIS

#### Full Mint Flow: User → tokenURI → SVG

```
1. User initiates mint in browser
2. Frontend calls server /compute-account → PhilAccountFactory.getPhilAddress()
3. Frontend calls server /request-mint → server returns MintProof from DB
4. Frontend builds UserOp:
   callData = execute(PhilTestMint, 0, mint(recipient, mintTo, philId, ...))
   If account not deployed: initCode = factory.createPhilAccount.selector + args
5. Frontend calls server /sign-paymaster → server signs paymasterAndData
6. Frontend signs userOpHash with EOA
7. Frontend submits UserOp to bundler
8. EntryPoint.handleOps:
   a. Creates account if initCode present
   b. Calls PhilAccount.validateUserOp → _validateSignature (ECDSA recovery)
   c. Calls PhilAccount._enforceUserOpPolicy → _scopeForCall → _enforcePolicy
      (mint call has no restricted scope, passes)
   d. Calls PhilPaymaster.validatePaymasterUserOp
      → decodes paymasterAndData
      → recovers verifyingSigner
      → calls _isSponsoredMint (checks execute→mint selector and target)
   e. Calls PhilAccount.execute(PhilTestMint, 0, mintCalldata)
      → _enforcePolicy: mint() has no scope, passes
      → PhilTestMint.mint(...)
         → validates philId < 6, paletteVariant < 9, mixMode <= 2
         → checks totalSupply < 13
         → gate.verifyAndConsume(recipient, mintTo, ...)
            → checks expiry
            → MerkleProofLib.verifyCalldata(merkleProof, MERKLE_ROOT, leaf)
            → recomputes claimHash and factHash
            → ECDSA.recoverCalldata(claimHash.toEthSignedMessageHash(), sig) == recipient
            → nullifier = keccak256(recipient, factHash); require !nullifierUsed[nullifier]
            → nullifierUsed[nullifier] = true
         → stores token traits
         → _mint(mintTo, tokenId) [Solady ERC721]
         → emit PhilMinted

tokenURI(tokenId):
   → renderer.tokenURI(tokenId, philId, paletteVariant, mixMode, mixSeed)
   → if compactTokenURI && gateway != 0:
       return "web3://<gateway>/svg/<philId>/..." (does NOT render on-chain in this path)
   → else:
       renderSvg(philId, paletteVariant, mixMode, mixSeed)
       return "data:application/json;utf8,{...base64(svg)...}"

renderSvg:
   → reads paletteData from SSTORE2
   → builds mixedOrder via XorShift32
   → for each slot: reads chunks from SSTORE2, optionally DSL-decodes, applies palette
   → returns full SVG string
```

#### Trust Boundaries

```
TRUSTED (immutable post-deploy):
  ProofGateTest13: PROGRAM_HASH, DROP_ID, MERKLE_ROOT, mintContract
  PhilFragments: all chunk pointers and offset table
  PhilPalettes: all palette pointers

TRUSTED (immutable at construction, owner-mutable):
  PhilRenderer: gateway (owner-changeable), compactTokenURI (owner-changeable)
  PhilTestMint: royaltyReceiver (owner-changeable), owner (transferable)
  PhilPaymaster: verifyingSigner (immutable), entryPoint (immutable), philTestMint (immutable)

OPERATOR-TRUSTED (off-chain):
  Backend proof server: controls proof issuance and paymaster signing
  Backend admin key: can inject proofs (mitigated by nullifier burn on-chain)

EXTERNAL TRUST (production):
  Atlantic/Herodotus: STARK proving service
  Starknet L1 Core: for unlock ticket messaging
  ERC-4337 bundler: for UserOp relaying

UNTRUSTED:
  Browser / user device
  Frontend JS (client-side, no runtime guarantees)
```

---

### C. SECURITY SURFACE REVIEW

#### C.1 Reentrancy

**PhilTestMint.mint():** Calls `gate.verifyAndConsume()` BEFORE `_mint()`. The gate is an immutable address. Gate does not call back into PhilTestMint. No ETH transfers. CEI is followed.
**Risk: NONE**

**PhilPaymaster.deposit():** `entryPoint.call{value: msg.value}("")` — raw call. No state mutation after.
**Risk: NONE**

**PhilPaymaster.withdraw():** Calls `entryPoint.call(withdrawTo(...))`. No state mutation after.
**Risk: NONE**

**PhilUnlockInbox (referenced in SPEC, not present in repo):** SPEC notes `starknetCore.consumeMessageFromL2()` called before state update. CEI violation. Not in current contract set but would apply if implemented.
**Risk: LOW (if implemented as described in SPEC)**

**PhilAccountFactory.createPhilAccount():** Calls `account.call(initVaultConfig(...))` after deploying. Account is freshly deployed, no circular call risk. If initVaultConfig fails silently (no revert), account is unconfigured.
**Risk: LOW (silent failure, not reentrancy)**

#### C.2 Upgrade Risks

**PhilAccount** extends Solady `ERC4337` which extends `UUPSUpgradeable`. Upgrades are gated by `_authorizeUpgrade` which calls `_requireUnlockForSelf(S_UPGRADE_WALLET)` AND `_checkOwner()`. This means:
- Upgrade requires owner signature AND (if starkScopeMask includes S_UPGRADE_WALLET) a valid STARK unlock ticket.
- If starkScopeMask is 0 (default), upgrade only requires owner signature — no STARK gating by default.
**Risk: MEDIUM — Upgrade path exists. Default configuration does not require STARK gating for upgrades.**

**PhilTestMint, PhilRenderer, ProofGateTest13, PhilFragments, PhilPalettes:** Not upgradeable. No proxy. Immutable logic.
**Risk: NONE for these contracts**

**PhilPaymaster:** Not upgradeable. `verifyingSigner` is immutable. Key rotation requires new deploy.
**Risk: LOW (operational, not exploit)**

#### C.3 External Call Risks

**PhilPaymaster.deposit()/withdraw():** Raw calls to `entryPoint`. EntryPoint is immutable at construction — trusted. No return value check on deposit (only ETH forwarding). Withdraw checks `success` from `entryPoint.call(...)`.
**Finding: LOW — deposit() does not check success of ETH forwarding.**

**PhilAccountFactory.createPhilAccount():** Two external calls:
1. `account.staticcall(unlockInbox())` — reads state, safe.
2. `account.call(initVaultConfig(...))` — writes state. Success is checked but failure is NOT reverted.
**Finding: MEDIUM — Silent initVaultConfig failure leaves account without unlock inbox.**

**PhilRenderer:** Calls `SSTORE2.read(ptr)` for fragments and palettes. SSTORE2 reads are safe view operations. Fragment and palette pointers are set at construction — trusted.
**Risk: NONE**

**ProofGateTest13:** Calls `MerkleProofLib.verifyCalldata()` — pure library function.
Calls `ECDSA.recoverCalldata()` — pure library function. No external calls.
**Risk: NONE**

#### C.4 Signature Validation Surface

**ProofGateTest13:**
- `claimHash` includes: DROP_ID, chainId, address(this), recipient, mintTo, philId, paletteVariant, mixMode, mixSeed, expiry.
- Full cross-chain, cross-gate, cross-drop, cross-intent replay protection.
- Uses `ECDSA.toEthSignedMessageHash(claimHash)` — correct EIP-191 prefixing.
- Uses `ECDSA.recoverCalldata` from Solady — handles compact signatures (64 bytes) and standard (65 bytes). Includes malleability protection (Solady ECDSA reverts on invalid `s` values).
- **No ECDSA malleability risk.**

**PhilPaymaster:**
- Hash includes: sender, nonce, keccak(initCode), keccak(callData), accountGasLimits, preVerificationGas, gasFees, chainId, address(this), validUntil, validAfter.
- Does NOT include `paymasterAndData` signature portion (correct — it would be circular).
- Uses `ECDSA.recoverCalldata` — same Solady lib.
- **Finding: MEDIUM — Signature check and policy check ordering is inverted. Signature is recovered first but the `sigFailed` return is set based on whichever check fails first in sequential logic. The actual code (reading it carefully):**

```solidity
// Recover signer first
address recovered = ECDSA.recoverCalldata(ethSignedHash, signature);

// Check sig
if (recovered != verifyingSigner) {
    return ("", _packValidationData(true, validUntil, validAfter));
}

// THEN check policy
if (!_isSponsoredMint(userOp)) {
    return ("", _packValidationData(true, validUntil, validAfter));
}
```

**Re-reading the actual code in PhilPaymaster.sol — the signature check IS first.** The prior audit report had this wrong. The signature is recovered and checked before policy. This is correct ordering. The prior finding was in error.
**Risk: NONE (the code is actually correct)**

**PhilAccount._validateSignature:**
- Recovers signer from `ECDSA.toEthSignedMessageHash(userOpHash)`.
- Checks `isOwner[recovered]`.
- Returns 0 (success) or 1 (fail).
- If owner check passes, calls `_enforceUserOpPolicy`.
- `_enforceUserOpPolicy` reverts on policy violation — this means the entire `validateUserOp` reverts rather than returning sigFailed=1. This causes the EntryPoint to revert the UserOp rather than marking it as failed.
**Finding: MEDIUM — Policy violations in _enforceUserOpPolicy cause validateUserOp to revert (not return sig-failed). EntryPoint will charge the account for the failed validation. This is spec-conformant (account pays for failed validation) but could cause gas loss if policy checks are unexpectedly triggered.**

#### C.5 Proof Verification Assumptions

**Current ProofGateTest13 is NOT a STARK verifier.** It is an ECDSA + Merkle + commitment scheme. The "factHash" is a local construction, not a fact registered by an Atlantic Satellite.

The `IAtlanticSatellite.isValid(factHash)` interface exists but is not called anywhere in the current contract set. `MockSatellite` is present for testing a flow that does not yet exist on-chain.

**Critical Gap:** The SPEC describes a production flow where `ProofGateTest13` (or a production successor) calls `IAtlanticSatellite.isValid(computedFactHash)`. The current implementation skips this and uses local signature verification instead. This is architecturally significant for mainnet.

**Assumptions that hold:**
- Merkle root is pinned at construction — allowlist is immutable.
- claimHash commits to full mint intent — no parameter substitution attacks.
- factHash commits to (PROGRAM_HASH, claimHash, MERKLE_ROOT, witnessHash) — binds proof to specific program and tree.
- Nullifier = keccak256(recipient, factHash) — unique per (recipient, mint-intent).
- chainId in claimHash prevents cross-chain replay.
- address(this) in claimHash prevents cross-gate replay.

#### C.6 Centralized Infrastructure Reliance

| Dependency | Centralized? | Impact if Unavailable |
|---|---|---|
| Backend proof server | YES | No new mints possible |
| Atlantic STARK prover | YES (production) | No new proofs |
| ERC-4337 bundler | YES (public) | No UserOp submission |
| Starknet L1 core | YES (infra) | No unlock tickets |
| web3:// gateway | YES (external resolver) | tokenURI unresolvable in compact mode |

**Finding: HIGH — In compact tokenURI mode (default), tokenURI requires an external ERC-4804 resolver. If the gateway goes down, tokenURIs become non-resolvable by standard NFT tooling. The on-chain SVG data remains intact but is inaccessible via standard metadata calls.**

---

### D. GAS & STORAGE EFFICIENCY REVIEW

#### D.1 SSTORE2 Usage

**PhilFragments:** Stores SSTORE2 pointers in a dynamic array. Constructor validates monotonic offsets. Each fragment reads chunks via `SSTORE2.read()` (EXTCODECOPY of deployed bytecode). This is the correct pattern for large on-chain data.

**PhilPalettes:** Stores one SSTORE2 pointer per phil. `SSTORE2.read()` on each render call reads the entire palette blob. For 6 phils × 9 palettes × slotCount × 3 bytes, this is typically 100–300 bytes per phil — very cheap.

**SSTORE2 correctness:** Both contracts initialize pointers at construction and never update them. This is correct — SSTORE2 data is permanently stored as contract bytecode.

#### D.2 Storage Redundancy

**PhilTestMint:**
- `mapping(uint256 => uint8) public philIdOf` — 4 separate mappings for token traits.
- Could be packed into one struct mapping: `mapping(uint256 => TokenTraits)` with a packed struct (philId: uint8, paletteVariant: uint8, mixMode: uint8, mixSeed: uint32).
- Current: 4 SSTORE reads per tokenURI call.
- Packed: 1 SSTORE read per tokenURI call.
**Finding: LOW-MEDIUM — Trait storage is unoptimized. 4 separate mappings vs 1 packed struct. Gas savings: ~3 SLOAD per tokenURI call (cold: ~6000 gas savings).**

#### D.3 Unpacked Structs / Struct Layout

**PhilAccount storage:**
```solidity
mapping(address => bool) public isOwner;    // 32 bytes per slot (bool wastes 31 bytes)
uint32 public ownerCount;                   // could pack with below
address public unlockInbox;                 // 20 bytes — could pack with ownerCount
address public philTestMint;                // 20 bytes
uint32 public starkScopeMask;               // 4 bytes
uint256 public largeSpendWei;               // 32 bytes
```
- `ownerCount` (uint32) and `starkScopeMask` (uint32) could share a slot with each other.
- `unlockInbox` and `philTestMint` are addresses (20 bytes each) — cannot pack with each other but could pack with smaller types.
- Since PhilAccount is a UUPS proxy, storage layout must remain stable for upgrades.
**Finding: LOW — Minor slot inefficiency. Not critical given ERC-4337 account context.**

#### D.4 Repeated Logic

**`_concatBytes` / manual byte concatenation:** Both `PhilRenderer` and `PhilDSLDecoder` implement manual byte-by-byte copying in loops. Could use assembly (`mstore`) for significant gas savings on large SVG outputs.

**`_appendStr` / `_appendUint` in PhilDSLDecoder._decodeV1:** Multiple manual copy helpers. This is a library — called from view functions. Gas cost is caller's burden (off-chain reads are free). For on-chain calls (tokenURI from contracts), this matters.

#### D.5 SVG Inefficiencies

**DSL v2 dictionary has 43 tokens.** The dictionary is hardcoded via `if (id == N) return bytes(...)` chain — 43 branches. A mapping or storage array would be more maintainable but would cost SLOAD gas. Since this is a library (`pure` function), the if-chain is compiled to JUMPI opcodes and is actually gas-efficient.

**Fragment chunk size is 24kB.** Ethereum's 24kB contract bytecode limit applies to SSTORE2 chunks. Using 24kB chunks is correct — at the limit.

**`_applyPalette` over-allocates:** `source.length * 3 + 16`. For typical SVG fragment sizes, this is 3x the actual output size. Memory allocation in EVM is expensive for large buffers. The truncation with `mstore(out, outOffset)` at the end is correct but wastes gas on allocation.

**Finding: MEDIUM — `_applyPalette` over-allocates memory 3x. For large fragments this wastes gas on memory expansion. A two-pass approach (count then allocate) would save memory gas.**

#### D.6 Potential Compression Strategies

- DSL v2 is already implemented and provides ~3x compression vs raw SVG bytes.
- V1 geometric DSL is superseded by v2 — v1 code paths can be removed.
- ZLIB/deflate on-chain decompression (via existing Solidity libs) could further reduce storage but adds decompressor complexity and gas cost per render.
- Current approach (DSL v2 + SSTORE2 chunking) is appropriate for the design goals.

---

### E. REPO HYGIENE REVIEW

#### E.1 Dead Code

**`contracts/mocks/DeployAndMintHelper.sol`:** Interface `IPhilMintLike.mint()` has signature `(address, address, uint8, uint8, uint8, uint8, uint8, uint8, bytes32, uint256[6])` — this is a stale interface that does not match `PhilTestMint.mint()` current signature `(address, address, uint8, uint8, uint8, uint32, IProofGate.MintProof)`. This mock is broken and would fail at compile time if actually used against PhilTestMint.
**Risk: MEDIUM — Stale mock. Will not compile correctly if relied upon in tests.**

**`contracts/mocks/MockRenderer.sol`:** `tokenURI()` and `renderSvg()` have parameter counts (7 and 6 respectively) that do not match any current renderer interface. This is dead code.
**Risk: LOW — Unused mock.**

**`contracts/LocalSmartAccount.sol` + `LocalSmartAccountFactory.sol`:** Dev-only. Not used in any production flow. Duplication with PhilAccount (simpler version).
**Risk: LOW — Dev scaffolding, but should be in a `dev/` or `local/` subdirectory.**

**`sharpAccountV1/`:** Independent 2FA smart account module with its own Cairo program. Not integrated with the current PhilAccount/PhilAccountFactory flow. The `SharpAccount.sol` uses a different interface (`SHARP_PROGRAM_HASH`, different EIP-712 domain). This appears to be a prior version or parallel experiment.
**Risk: LOW — Dead module. Misleading to leave alongside production contracts.**

#### E.2 Orphaned Scripts

**`scripts/render_all_phils.mjs`:** 25 lines, renders all 54 variants. Uses `renderPhil` from shared renderer. Useful utility — not orphaned.

**`scripts/verify_fact_hash.mjs`:** Checks Atlantic Satellite for fact validity. Only useful when Atlantic flow is active — currently the local proof gate doesn't use Atlantic. Orphaned for current local flow.

**`scripts/dsl-to-svg.mjs`:** Decode-side of DSL pipeline. Useful for testing. Not orphaned.

**`allowlist.json`:** Root-level. Contains 13 identical addresses (all `0x247c2aB886014F20ad0514444ddb05ab15002F2e`). This is clearly a dev placeholder. On mainnet this must be a real 13-address deduplicated list.
**Risk: HIGH — Allowlist is currently 13 copies of one address. If deployed as-is, only one person can mint (the same address 13 times, but nullifier prevents replay). This must be replaced before mainnet.**

#### E.3 Duplicate Logic

**`renderPhil.mjs` (shared) and `PhilRenderer.sol`:** Both implement XorShift32, Fisher-Yates, slot token parsing, palette application. This duplication is intentional and necessary for off-chain preview parity. The risk is drift — any change to one must be mirrored in the other.

**`merkle.mjs` (shared) and `MerkleProofLib` (Solady on-chain):** Both implement standard sorted-pair Merkle tree. Off-chain builds tree, on-chain verifies proofs. These are different roles — not duplication.

**`localStarkProver.mjs` (shared) and `ProofGateTest13.sol`:** Off-chain proof builder mirrors on-chain verifier. Intentional.

**`computeClaimHash` / `computeExpectedFactHash`:** Duplicated in ProofGateTest13.sol, localStarkProver.mjs, server-ts/lib/factHash.ts. Three implementations of the same function. Any drift between them breaks the proof flow.
**Finding: HIGH — Three copies of claimHash and factHash computation. No shared canonical test vector suite enforcing parity across all three.**

#### E.4 Unused Dependencies

**`react@19.2.4` and `react-dom@19.2.4`:** In root `package.json`. The frontend is plain HTML/JS — no React components found in `frontend/`. React is used by `vite` dev server or a frontend-local build, but not by the production frontend.

**`ganache@7.9.2`:** Listed as a dependency. Hardhat's built-in network is used for local dev (chainId 31337). Ganache appears redundant.

**`starknet@9.2.1`:** Used in `frontend/starkKey.js` for STARK key generation. This is a large dependency (9MB+). Only `starknet.js` key generation features are used — a minimal STARK key library would reduce bundle size significantly.

#### E.5 Inconsistent Config Files

**`package.json` name field:** `"name": "ogcopy"` — this is not the project name. Appears to be a copy-paste artifact.
**Risk: LOW — No functional impact but unprofessional for a mainnet-bound project.**

**`package.json` dependency ranges:** `solady`, `ethers`, `hardhat` all use `^` semver ranges. For a mainnet-bound project, all should be pinned to exact versions.
**Risk: HIGH — `solady` specifically contains ECDSA, MerkleProofLib, SSTORE2, ERC721, ERC4337. Any solady update can change compiled contract bytecode or behavior.**

**`hardhat.config.cjs`:** Uses `cjs` extension for CommonJS in an otherwise ES module project. Not an error but adds tooling friction.

**`deployments/` directory exists:** Empty or near-empty. No deployment receipts or verified addresses stored. For a production project, this should contain canonical deployment manifests.

**Two palette files:** `phil-palettes-v2.json` and `phil-palettes.json`. V1 is superseded. No comments in either file explaining the difference or which is canonical.

#### E.6 Test Coverage Gaps (Critical)

| Missing Test | Risk Level |
|---|---|
| `SoldOut()` at supply cap (13+1 mint attempt) | HIGH |
| `ProofExpired()` when expiry < block.timestamp | HIGH |
| `UnauthorizedCaller` — direct gate call not via mint | HIGH |
| `InvalidRecipient` / `InvalidMintTo` zero address | MEDIUM |
| `BadPhilId` / `BadPaletteVariant` / `BadMixMode` boundary | MEDIUM |
| Exact tokenURI output golden snapshot | HIGH |
| Compact vs full tokenURI mode comparison | MEDIUM |
| `PhilAccount` scope policy enforcement (transfer, listing, large spend) | HIGH |
| `PhilAccount` upgrade path (owner + STARK gating) | HIGH |
| `PhilPaymaster._sponsorshipCheckReason` all failure codes | MEDIUM |
| claimHash / factHash parity across all 3 implementations | CRITICAL |
| renderSvg output hash stability (no drift across builds) | CRITICAL |
| `PhilFragments` constructor invalid offset rejection | MEDIUM |
| `PhilPalettes` colorAt boundary conditions | LOW |
| `PhilAccountFactory` silent initVaultConfig failure | MEDIUM |

---

## PHASE 3 — CRITICAL RECOMMENDATIONS

---

### 1. MUST REMOVE

**R1. `allowlist.json` — 13 identical addresses**
This file contains 13 copies of the same address. If ProofGateTest13 is deployed with a Merkle root derived from this list, only one address can participate. Replace with real unique addresses before any mainnet deployment.
**Risk: CRITICAL**

**R2. `mocks/DeployAndMintHelper.sol` — stale interface**
`IPhilMintLike.mint()` signature does not match `PhilTestMint.mint()`. This mock will cause compile or runtime failure if used. Either update to match current interface or remove.
**Risk: MEDIUM**

**R3. `mocks/MockRenderer.sol` — stale interface**
`tokenURI()` and `renderSvg()` parameter counts do not match any current interface. Dead code.
**Risk: LOW**

**R4. `sharpAccountV1/` — dead parallel module**
This is a prior or parallel architecture not integrated with the current system. Its presence alongside production contracts is misleading. Move to a `legacy/` or `archive/` directory outside the production contract tree, or remove.
**Risk: LOW (dead code, not dangerous, but creates confusion)**

**R5. `shared/phil-renderer/phil-palettes.json` (v1 palette)**
V2 is the canonical version. V1 being present creates ambiguity about which is authoritative. Remove or move to `archive/`.
**Risk: LOW**

---

### 2. SHOULD REMOVE

**R6. `contracts/LocalSmartAccount.sol` + `contracts/LocalSmartAccountFactory.sol`**
Dev-only scaffolding in the main contracts directory. Move to `contracts/dev/` or `contracts/local/`. Do not ship in a production deployment package.

**R7. `contracts/EntryPointLocalMock.sol`**
Test/local-only mock. Same concern as above. Move to `contracts/local/` or `contracts/mocks/`.

**R8. `scripts/verify_fact_hash.mjs`**
Currently dead for local flow (Atlantic is not called by ProofGateTest13). Keep only if Atlantic integration is being actively built. Otherwise, creates confusion about the actual proof architecture.

**R9. `ganache` dependency**
`hardhat` built-in network is used. `ganache` appears unused. Remove from `package.json`.

**R10. `react` + `react-dom` dependencies (if unused)**
Verify whether any active frontend code requires React. If `frontend-local` uses it, move to a workspace or subdirectory `package.json`. Do not include in root.

**R11. `package.json` `name: "ogcopy"`**
Change to reflect actual project name before mainnet.

---

### 3. SHOULD ADD

**A1. Atlantic Satellite integration in ProofGateTest13 (or production successor)**
The contract must call `IAtlanticSatellite.isValid(computedFactHash)` for the STARK proof to be the actual security primitive. Without this, the proof gate is ECDSA-only with no STARK involvement.

The architectural choices are:
- Option A: Deploy a `ProofGateProd.sol` that inherits the current verification logic AND additionally calls `satellite.isValid(proof.factHash)`.
- Option B: Replace the local factHash scheme with direct Atlantic fact verification where the contract only checks `satellite.isValid(keccak256(abi.encode(PROGRAM_HASH, outputs)))`.

**This is the most important functional addition for mainnet.**

**A2. `_applyPalette` memory pre-calculation pass**
Replace the 3x over-allocation with a two-pass approach: count output bytes in pass 1, allocate exact size, write in pass 2. Reduces memory expansion gas cost for large SVG fragments.

**A3. Exact version pinning for all dependencies**
```json
"solady": "0.0.281",
"ethers": "6.16.0",
"hardhat": "2.28.4"
```
Run `npm ci` (not `npm install`) in all deployment contexts.

**A4. Token trait packing in PhilTestMint**
Replace 4 separate mappings with a single packed struct mapping:
```solidity
struct TokenTraits {
    uint8 philId;
    uint8 paletteVariant;
    uint8 mixMode;
    uint32 mixSeed;
}
mapping(uint256 => TokenTraits) public traits;
```
Saves 3 SLOAD/SSTORE per mint and tokenURI call. Reduces storage slots from 4 per token to 1.

**A5. `initVaultConfig` failure must revert in factory**
In `PhilAccountFactory.createPhilAccount()`, if the `initVaultConfig` call fails (first call, not idempotent skip), the transaction must revert:
```solidity
require(success, "initVaultConfig failed");
emit PhilAccountCreated(account, owner, starkPubKeyX);
```
Current code silently skips without reverting.

**A6. Missing test suite items**
Implement tests for all items in section E.6. Priority order:
1. claimHash/factHash parity (server-ts ↔ ProofGateTest13 ↔ localStarkProver)
2. Supply cap (SoldOut at tokenId 13)
3. renderSvg hash stability snapshot
4. PhilAccount scope policy enforcement
5. ProofExpired and UnauthorizedCaller

**A7. Makefile or justfile for reproducible build commands**
Document exact invocation sequence for: compile → fragment-build → fragment-deploy → proof-setup → local-e2e. Currently requires reading multiple README files and scripts to reconstruct.

**A8. `deployments/` manifests**
Store deployment artifacts (addresses, tx hashes, block numbers, constructor args, compiler version) in `deployments/<chainId>.json`. Required for verification on Etherscan and for upgrade tracking.

**A9. `PhilRenderer.tokenURI` gateway null check**
In compact mode, if `gateway == address(0)`, the function will return a `web3://0x0000...` URL. This is already partially handled (`if (compactTokenURI && gateway != address(0))`) — confirmed correct. No change needed, but add a test.

**A10. `PhilPaymaster.deposit()` success check**
```solidity
(bool success,) = entryPoint.call{value: msg.value}("");
require(success, "deposit failed");
```
The low-level call to entryPoint for deposit does not check success. Add the require.

---

### 4. SHOULD RESTRUCTURE

**S1. Contract directory organization**
Separate production contracts from dev/test infrastructure:
```
contracts/
├── core/               # PhilTestMint, ProofGate, PhilRenderer, PhilFragments,
│                       #   PhilPalettes, PhilDSLDecoder (library), PhilAccount,
│                       #   PhilAccountFactory, PhilPaymaster, PhilWeb3
├── interfaces/         # IProofGate, IAtlanticSatellite, IERC4804
├── local/              # LocalSmartAccount, LocalSmartAccountFactory, EntryPointLocalMock
└── mocks/              # MockSatellite, MockRenderer (once updated)
```

**S2. Off-chain renderer parity enforcement**
The three copies of `computeClaimHash` / `computeExpectedFactHash` (Solidity, JS, TypeScript) should be validated against a shared canonical test vector file at every CI run. Currently `shared/fact_hash_vectors.json` has 2 vectors — expand to cover all mint parameter combinations and run assertions from all three implementations.

**S3. `PhilDSLDecoder` V1 deprecation**
V1 is a legacy format. The V1 decoder (`_decodeV1`) is still present and functional. If no production fragments use V1 encoding (confirmed: only bgstars, bgdust, bodyshapes use DSL, all encoded in V2), the V1 code path should be removed to reduce contract size and simplify the decoder. This saves ~3kB bytecode.

**S4. `PhilPaymaster._sponsorshipCheckReason` hardening**
The inner calldata parsing (`dataOffset` decoding) assumes specific ABI encoding of `execute(address, uint256, bytes)`. This is fragile — any non-standard encoding would fail the check. Add a bounded-length guard and a clear error code for each failure case.

**S5. Server-ts / shared / scripts dependency isolation**
`scripts/` imports from `shared/` (renderPhil, merkle, localStarkProver). `server-ts/` has its own copies of some utilities. This should be consolidated: either `shared/` is the canonical source and server-ts imports it, or each is isolated. Currently the factHash computation exists in 3 places (JS, TS, Solidity).

---

### 5. DO NOT TOUCH

These elements are architecturally correct, align with the cypherpunk ethos, and must not be modified:

**D1. `Layers/Phil{0..5}/*.svg`** — Canonical artwork. Any change alters on-chain output.

**D2. `shared/phil-renderer/phil-palettes-v2.json`** — Canonical palette data. Any change alters all rendered outputs.

**D3. `contracts/PhilDSLDecoder.sol` — DSL dictionary and opcodes.** Any change invalidates all DSL-encoded fragments on-chain. V1 decoder can be removed (see S3) but the V2 dict must be frozen.

**D4. `shared/phil-renderer/renderPhil.mjs` — PRNG and mixing logic.** XorShift32 seed, Fisher-Yates implementation, golden seed `0x9e3779b9`, slot token format `@XX`. Must remain byte-for-byte equivalent to PhilRenderer.sol.

**D5. `contracts/PhilRenderer.sol` — `_buildMixedOrder`, `_applyPalette`, `_nextRand`, `GOLDEN_MIX_SEED`.** Core rendering logic. Frozen.

**D6. `contracts/ProofGateTest13.sol — computeClaimHash() encoding order and field set`.** Any change breaks all existing proofs and nullifiers.

**D7. `contracts/ProofGateTest13.sol — nullifier formula`.** `keccak256(abi.encodePacked(recipient, proof.factHash))`. Any change invalidates burned nullifiers.

**D8. `shared/proof/merkle.mjs — hashPair() and leafForAddress()`.** Must remain compatible with `MerkleProofLib.verifyCalldata`.

**D9. `contracts/PhilFragments.sol — constructor offset validation and SSTORE2 chunk pointer storage`.** Correct and immutable after deploy.

**D10. `contracts/PhilPalettes.sol — color packing layout`.** Must match renderer's `colorOffset` formula.

**D11. SSTORE2 as the storage primitive.** Do not replace with IPFS, Arweave, or any external storage. Do not change to contract storage (vastly more expensive).

**D12. ERC-4337 account abstraction.** Do not simplify to EOA-only flow. The smart account with scope-based policy is the security model.

**D13. Cairo / STARK proof system for the production gate.** Do not replace with simpler allowlist or centralized signature. The Atlantic STARK integration is the target — the current local scheme is a development substitute only.

---

## PHASE 4 — REPLICA IMPROVEMENT PLAN (phil_replica_candidate)

---

### Dependency Graph

```
PhilDSLDecoder (library)
    └── used by: PhilRenderer

PhilFragments (immutable after deploy)
    └── reads: SSTORE2 chunk pointers
    └── used by: PhilRenderer

PhilPalettes (immutable after deploy)
    └── reads: SSTORE2 palette blobs
    └── used by: PhilRenderer

PhilRenderer
    ├── imports: PhilDSLDecoder (library)
    ├── reads: PhilFragments
    ├── reads: PhilPalettes
    └── used by: PhilTestMint (tokenURI), PhilWeb3

PhilWeb3
    └── calls: PhilRenderer.renderSvg()

IProofGate (interface)
    └── implemented by: ProofGateTest13

ProofGateTest13 (immutable after deploy)
    ├── implements: IProofGate
    ├── reads: MerkleProofLib (Solady)
    └── used by: PhilTestMint

PhilTestMint
    ├── extends: ERC721 (Solady)
    ├── calls: ProofGateTest13.verifyAndConsume()
    └── calls: PhilRenderer.tokenURI()

IAtlanticSatellite (interface, NOT YET USED)
    └── target implementation: Herodotus Atlantic Satellite

PhilAccount
    ├── extends: ERC4337 (Solady, UUPS proxy)
    ├── reads: PhilUnlockInbox.getTicket()
    └── used by: PhilAccountFactory

PhilAccountFactory
    ├── extends: ERC4337Factory (Solady)
    └── deploys: PhilAccount proxies

PhilPaymaster
    ├── extends: Ownable (Solady)
    └── restricts: PhilTestMint.mint() calls only
```

### Contract Interaction Diagram (Text)

```
                    ┌─────────────────────────────────────────────────┐
                    │                  EntryPoint (v0.7)              │
                    └───────┬─────────────────────────┬───────────────┘
                            │ validateUserOp           │ validatePaymasterUserOp
                            ▼                         ▼
                    ┌───────────────┐        ┌──────────────────┐
                    │  PhilAccount  │        │  PhilPaymaster   │
                    │  (UUPS proxy) │        │  (Ownable)       │
                    └───────┬───────┘        └──────────────────┘
                            │ execute()
                            ▼
                    ┌───────────────────┐
                    │   PhilTestMint    │
                    │   (ERC721, 13-cap)│
                    └───────┬───────────┘
                            │ verifyAndConsume()
                            ▼
                    ┌───────────────────┐
                    │ ProofGateTest13   │
                    │ (MerkleProofLib   │
                    │  ECDSA, nullifier)│
                    └───────────────────┘
                            │ [MISSING: satellite.isValid(factHash)]
                            ▼
                    ┌───────────────────┐
                    │ IAtlanticSatellite│ ◄── NOT CONNECTED IN CURRENT CODE
                    └───────────────────┘

tokenURI flow:
                    ┌───────────────────┐
                    │   PhilTestMint    │
                    └───────┬───────────┘
                            │ renderer.tokenURI()
                            ▼
                    ┌───────────────────┐
                    │   PhilRenderer    │
                    └──┬────────────────┘
                       │ fragments.fragmentRange() + chunkPtr()
                       │         ▼
                       │  ┌─────────────────┐
                       │  │  PhilFragments  │──→ SSTORE2 chunks
                       │  └─────────────────┘
                       │ palettes.palettePointer() + slotCount()
                       │         ▼
                       │  ┌─────────────────┐
                       │  │  PhilPalettes   │──→ SSTORE2 palette blobs
                       │  └─────────────────┘
                       │ PhilDSLDecoder.decode() [if isDsl]
                       │         ▼
                       │  ┌─────────────────┐
                       │  │ PhilDSLDecoder  │ (library)
                       │  └─────────────────┘
                       ▼
                    Full SVG string

web3:// path:
                    ┌──────────────────┐
                    │   PhilWeb3       │ (ERC-4804)
                    └────┬─────────────┘
                         │ renderSvg()
                         ▼
                    ┌──────────────────┐
                    │   PhilRenderer   │
                    └──────────────────┘
```

### Prioritized Execution List

Priorities are sequenced to avoid breaking mint flow, preserve artwork determinism, and incrementally close security gaps.

```
TIER 0 — PRE-DEPLOYMENT BLOCKERS (do before any mainnet use)

  P0-1: Replace allowlist.json with real 13 unique addresses.
        Derive MERKLE_ROOT from this list.
        Deploy ProofGateTest13 with correct root.
        BLOCKS: All minting.

  P0-2: Pin all dependency versions in package.json to exact versions.
        Run npm ci to verify lockfile is clean.
        BLOCKS: Reproducible builds.

  P0-3: Implement and run claimHash / factHash cross-implementation parity tests.
        Test vectors must pass against ProofGateTest13 (Solidity),
        localStarkProver.mjs (JS), and server-ts/lib/factHash.ts (TS).
        BLOCKS: Proof integrity confidence.

  P0-4: Resolve the Atlantic Satellite gap.
        Decision: deploy ProofGateProd.sol that adds satellite.isValid(factHash)
        call, OR document explicitly that local-ECDSA mode is the production scheme
        and remove misleading STARK language from user-facing docs.
        BLOCKS: Architectural honesty / security property.

TIER 1 — CORRECTNESS FIXES (do before beta/testnet)

  P1-1: Fix PhilAccountFactory silent initVaultConfig failure.
        Add require(success, "initVaultConfig failed") after first-call check.
        Risk: LOW change. No interface changes.

  P1-2: Fix DeployAndMintHelper.sol interface to match PhilTestMint.mint() signature.
        Or remove the file entirely.
        Risk: Test-only file. No production impact.

  P1-3: Add supply cap test (SoldOut at 14th mint).
        Add ProofExpired test.
        Add UnauthorizedCaller test (direct gate call).
        Add BadPhilId / BadPaletteVariant / BadMixMode boundary tests.
        Risk: Test-only additions.

  P1-4: Add PhilAccount scope policy tests.
        Test that transfer/approval calls are blocked without 2nd owner.
        Test that starkScopeMask gating works.
        Risk: Test-only additions.

  P1-5: Add tokenURI golden snapshot test.
        For fixed (philId=0, paletteVariant=0, mixMode=0, mixSeed=0),
        record exact tokenURI output and assert stability across builds.
        Risk: Test-only additions.

TIER 2 — GAS & STORAGE OPTIMIZATION (do before mainnet gas profiling)

  P2-1: Pack PhilTestMint token traits into single struct mapping.
        struct TokenTraits { uint8 philId; uint8 paletteVariant; uint8 mixMode; uint32 mixSeed; }
        mapping(uint256 => TokenTraits) public traits;
        Impact: 3 fewer SLOAD per tokenURI call. No interface change (keep public getters).

  P2-2: Fix _applyPalette memory over-allocation.
        Two-pass: count expected output bytes, then allocate exact size.
        Impact: Reduces memory expansion gas for large SVG fragments.

  P2-3: Remove PhilDSLDecoder V1 code (_decodeV1 and all V1 helpers).
        If no production fragments use V1 encoding, removing saves ~3kB bytecode.
        Verify with: grep -r "VERSION_V1" in build manifest first.

TIER 3 — REPO HYGIENE (do before public release)

  P3-1: Reorganize contracts/ directory (see S1 in SHOULD RESTRUCTURE).
        Move local/dev contracts to contracts/local/.
        No interface changes.

  P3-2: Remove sharpAccountV1/ from main codebase or move to archive/.

  P3-3: Remove phil-palettes.json (v1, superseded).

  P3-4: Fix package.json name field from "ogcopy" to actual project name.

  P3-5: Remove unused dependencies (ganache if confirmed unused, react if unused).

  P3-6: Create deployments/<chainId>.json manifest files for each deployment.

  P3-7: Add engines field to package.json: "engines": { "node": ">=18.20.0" }.

  P3-8: Create Makefile or justfile with canonical build/test/deploy invocations.

TIER 4 — PRODUCTION HARDENING (do before mainnet launch)

  P4-1: Deploy with 2-of-N multisig as owner of PhilTestMint and PhilRenderer.
        Single EOA ownership is a centralization risk post-launch.

  P4-2: Decide on tokenURI mode for mainnet.
        If compactTokenURI=true, document web3:// resolver dependency.
        If compactTokenURI=false, document gas cost of full-embed tokenURI.
        Consider making compactTokenURI immutable at deploy time.

  P4-3: Document STARK scope mask policy for PhilAccount.
        Default starkScopeMask=0 means no STARK gating. Document recommended mask
        for a fully-gated account: S_TRANSFER_PHIL | S_UPGRADE_WALLET | S_OWNER_CHANGE.

  P4-4: Add PhilPaymaster.deposit() success check (see A10).
```

---

## RISK SUMMARY

| ID | Finding | Severity |
|---|---|---|
| allowlist.json has 13 identical addresses | CRITICAL |
| ProofGateTest13 does not call IAtlanticSatellite.isValid() | CRITICAL |
| claimHash/factHash duplicated across 3 implementations, no parity enforcement | HIGH |
| solady and other deps use ^ semver range (not pinned) | HIGH |
| compactTokenURI=true default requires external web3:// gateway | HIGH |
| tokenURI golden snapshot test missing | HIGH |
| PhilAccount upgrade path not STARK-gated by default | MEDIUM |
| PhilAccountFactory silent initVaultConfig failure | MEDIUM |
| PhilTestMint has 4 separate trait mappings (unpacked) | MEDIUM |
| _applyPalette 3x memory over-allocation | MEDIUM |
| DeployAndMintHelper.sol stale interface | MEDIUM |
| Supply cap / expiry / gate caller tests missing | MEDIUM |
| PhilAccount scope policy tests missing | MEDIUM |
| PhilDSLDecoder V1 dead code path | LOW |
| sharpAccountV1/ parallel module not integrated | LOW |
| LocalSmartAccount in main contracts dir | LOW |
| MockRenderer stale interface | LOW |
| package.json name "ogcopy" | LOW |
| Build manifest generatedAt breaks reproducibility | LOW |
| Single-owner pattern on PhilTestMint and PhilRenderer | LOW (pre-mainnet) / MEDIUM (post-mainnet) |
| PhilPaymaster.deposit() no success check | LOW |
| phil-palettes.json (v1) present alongside v2 | LOW |

---

*End of Report. All findings target `phil_replica_candidate/` for remediation. Original files untouched.*
