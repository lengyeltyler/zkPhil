# E2E Guide — Phil Test13

End-to-end guide for running the complete Test13 local mint flow in `phil_replica_candidate`.

---

## What Test13 Is

Test13 is a local integration harness for minting all 13 Phil NFTs against the full
on-chain rendering and proof gate system. It uses:

- **ECDSA + Merkle allowlist proofs** (no SHARP submission required for local dev)
- **13 identical allowlist addresses** — intentional design for Test13 (one wallet mints all 13)
- **Embedded ganache** — no external node required
- **On-chain SVG rendering** — all art is assembled in Solidity, no IPFS, no off-chain URIs

---

## Prerequisites

```bash
cd phil_replica_candidate
npm ci
npx hardhat compile          # validate Solidity compilation (39 contracts)
node --test test/allowlist-proof.contract.test.mjs  # verify proof gate
```

---

## Quick Start

### 1. Generate proof package (optional — test13_e2e does this automatically)

```bash
node scripts/proofs/generate_proof_package.mjs
# → artifacts/proof_package.json
```

### 2. Run the full E2E mint-all-13 flow

```bash
node scripts/test13_e2e.mjs
```

This script:
1. Starts an embedded ganache instance (chainId=31337)
2. Loads `allowlist.json` (13 × same address)
3. Builds the Merkle tree
4. Deploys the full Phil system (SSTORE2 renderer assets, PhilFragments, PhilPalettes,
   PhilRenderer, ProofGateTest13, PhilTestMint, PhilWeb3)
5. Generates 13 proofs (ECDSA-signed, Merkle-verified)
6. Mints all 13 tokens on-chain
7. Verifies on-chain trait storage matches expected schedule
8. Spot-checks tokenURI output (SVG decoding or web3:// compact path)
9. Verifies replay protection (nullifier burn check)
10. Prints a summary table and saves a full report

**Expected output:**

```
╔══════════════════════════════════════════════════════════╗
║            Phil Test13 — E2E Mint All 13                ║
╚══════════════════════════════════════════════════════════╝

Allowlist:      allowlist.json
Recipient:      0x247c2aB886014F20ad0514444ddb05ab15002F2e (all 13 entries)
Program hash:   0x4444...4444
Drop ID:        13

Building Merkle tree from allowlist...
Merkle root:    0x...

Deploying Phil system ...
Deployed in ~60000ms
  SSTORE2Deployer:   0x...
  ProofGateTest13:   0x...
  PhilTestMint:      0x...

Generating proof package...
Minting all 13 tokens...
.............
Minted 13 tokens in ...ms

Verifying on-chain token traits and tokenURI...
.............

  tokenId │ philId │ palette │ mixMode │ mixSeed     │ recipient    │ svg
──────────┼────────┼─────────┼─────────┼─────────────┼──────────────┼──────
        0 │      0 │       0 │       1 │  3735929279 │ 0x247c...    │ inline ✓
        ...

✓ test13_e2e completed successfully.
✓ Replay protection verified (token 0 nullifier is burned).
```

---

## Outputs

| Path | Description |
|---|---|
| `artifacts/test13-e2e/report.json` | Full run report (all traits, timing, deployments) |
| `artifacts/test13-e2e/proof_package.json` | Signed proof package for all 13 |
| `artifacts/test13-e2e/svgs/token-N.svg` | Off-chain rendered SVG for each token |
| `deployments/stark_31337.json` | Deployment manifest (compatible with deploy_stark.mjs) |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | Hardhat account 0 key | Private key for deploying contracts |
| `PRIVATE_KEY` | Same as `DEPLOYER_PRIVATE_KEY` | Private key for the **allowlist** wallet (must match `allowlist.json` entries) |
| `PROGRAM_HASH` | `0x4444...44` | STARK program hash (local dev placeholder) |
| `DROP_ID` | `13` | Drop ID (must match ProofGateTest13 constructor arg) |
| `ALLOWLIST_FILE` | `allowlist.json` | Path to allowlist JSON |
| `RPC_URL` | (none — uses embedded ganache) | External RPC URL |
| `CHAIN_ID` | `31337` | Chain ID (must match RPC if `RPC_URL` is set) |
| `KEEP_OPEN` | `false` | Keep ganache running after E2E completes |

### Key: PRIVATE_KEY must match allowlist

All 13 entries in `allowlist.json` are `0x247c2aB886014F20ad0514444ddb05ab15002F2e`.
The proof gate uses ECDSA signature verification — the signer must be the recipient.

For **local dev** (embedded ganache): set `PRIVATE_KEY` to the private key for
`0x247c2aB886014F20ad0514444ddb05ab15002F2e`. If you don't have it, use the
Hardhat mnemonically derived key for your test accounts, or fund that address from
the ganache default accounts.

For **Hardhat node / test flow** where deployer happens to BE the allowlist address,
the default key works automatically.

---

## Test13 Allowlist Design

`allowlist.json` has 13 identical entries pointing to the same address. This is
**intentional** — it means one wallet can sequentially claim all 13 mints.

The Merkle tree built from 13 duplicate leaves has a single leaf value. The proof
for any index is identical (the tree produces the same Merkle path for all positions
since all leaves are the same hash). This makes the proof compact and deterministic.

**Why not 13 different wallets?** Test13 is about verifying the proof gate and
rendering system end-to-end with a single controlling wallet. The production
allowlist would have 13 distinct addresses.

---

## Trait Schedule

The test13_e2e script assigns traits deterministically:

| tokenId | philId | paletteVariant | mixMode | mixSeed |
|---|---|---|---|---|
| 0 | 0 | 0 | 1 | 0xdeadbeef |
| 1 | 1 | 1 | 0 | 0 |
| 2 | 2 | 2 | 0 | 0 |
| 3 | 3 | 3 | 0 | 0 |
| 4 | 4 | 4 | 1 | 0xdeadc326 |
| 5 | 5 | 5 | 0 | 0 |
| 6 | 0 | 6 | 0 | 0 |
| 7 | 1 | 7 | 0 | 0 |
| 8 | 2 | 8 | 2 | 0xdeadf65d |
| 9 | 3 | 0 | 0 | 0 |
| 10 | 4 | 1 | 0 | 0 |
| 11 | 5 | 2 | 0 | 0 |
| 12 | 0 | 3 | 1 | 0xdeb01e94 |

`philId ∈ [0,5]`, `paletteVariant ∈ [0,8]`, `mixMode ∈ {0,1,2}`.

---

## Running Individual Tests

```bash
# Proof gate + allowlist verification
node --test test/allowlist-proof.contract.test.mjs

# Error case coverage
node --test test/error-cases.contract.test.mjs

# Smart account smoke test (Phase 4)
node --test test/account.smoke.test.mjs

# Marketplace scope gating (Phase 5)
node --test test/marketplace.smoke.test.mjs

# Full test suite (original + Phase 4 + Phase 5)
node --test \
  test/fragments-dsl.test.mjs \
  test/svg-render.integration.test.mjs \
  test/allowlist-proof.contract.test.mjs \
  test/error-cases.contract.test.mjs \
  test/equivalence-snapshots.test.mjs \
  test/frontend-selection.integration.test.mjs \
  test/account.smoke.test.mjs \
  test/marketplace.smoke.test.mjs
```

---

## Architecture Reminder

```
allowlist.json (13 × same address)
  ↓
buildMerkleTree()                     ← shared/proof/merkle.mjs
  → merkleRoot (bytes32)
  ↓
deployPhilSystem()                    ← scripts/local/deployPhilSystem.mjs
  → ProofGateTest13(programHash, dropId, merkleRoot, futureMintAddress)
  → PhilTestMint(renderer, gate, royaltyReceiver)
  ↓
generateLocalMintProof()              ← shared/proof/localStarkProver.mjs
  → claimHash = keccak256(abi.encode(dropId, chainId, gate, recipient, mintTo, philId, palette, mixMode, mixSeed, expiry))
  → witnessHash = keccak256(concat(merkleProof))
  → factHash = keccak256(abi.encode(programHash, claimHash, merkleRoot, witnessHash))
  → signature = sign(claimHash) by recipient wallet
  ↓
PhilTestMint.mint(recipient, mintTo, philId, paletteVariant, mixMode, mixSeed, proof)
  → ProofGateTest13.verifyAndConsume()
      → Merkle: MerkleProofLib.verify(merkleProof, merkleRoot, leaf)
      → factHash: recompute and match
      → ECDSA: ecrecover(claimHash, signature) == recipient
      → Nullifier: burn keccak256(recipient, factHash)
  → PhilTestMint._mint(mintTo, tokenId)
  → PhilRenderer.tokenURI() ← on-chain SVG (SSTORE2 + DSL decoder + palette)
```

---

## Production Path (SHARP)

For production, replace the local ECDSA flow with:

1. Run the Cairo program at `cairo/src/allowlist.cairo` with Scarb:
   ```bash
   cd cairo && scarb build
   ```

2. Submit to SHARP (StarkWare proving service):
   - The SHARP submission registers `sharpFact` in `ISharpFactRegistry.isValid(fact)`
   - Production gate contract calls `sharpRegistry.isValid(factHash)` instead of
     recomputing locally

3. Deploy `contracts/proofs/DevProofVerifier.sol` on local (chainId=31337) or
   use the production `ISharpFactRegistry` on mainnet.

See `docs/PROOF_FORMAT.md` for the complete fact hash specification and
`scripts/proofs/README.md` for the SHARP pipeline architecture.
