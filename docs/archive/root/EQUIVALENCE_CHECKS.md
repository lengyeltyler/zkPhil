# Equivalence Checks

This document describes the automated checks that demonstrate the `phil_replica_audit` replica does not change:

- SVG rendered output (for fixed philId, paletteVariant, mixMode, mixSeed)
- Trait (palette slot) selection for fixed seeds
- Merkle/proof acceptance logic for known vectors
- DSL encode/decode roundtrip stability

---

## How to Run

```sh
# All equivalence checks (fast, no network)
npm run test:equivalence

# Full test suite including contract integration
npm test
```

---

## Test File

**`test/equivalence-snapshots.test.mjs`**

Six test cases that run against the golden snapshot file (`test/snapshots/golden.json`).

---

## Golden Snapshot File

**`test/snapshots/golden.json`**

Generated from the original repository by running:
```sh
node test/snapshots/gen_golden.mjs
```

The snapshot file contains SHA-256 hashes of rendered SVGs, exact slot-order arrays, Merkle tree roots/leaves/proofs, palette byte hashes, and proof hash vectors — all computed from fixed, deterministic inputs.

**Do not edit `golden.json` by hand.** Any change to the golden file must be accompanied by a documented justification and must flow through `gen_golden.mjs`.

---

## Check 1: SVG Render Equivalence

**Test:** `SVG renders match golden snapshots for all fixed test vectors`

**Method:** For each vector in the table below, `renderPhil(philId, paletteVariant, mixSeed, mixMode)` is called and the SHA-256 hash of the result is compared against the golden snapshot.

| philId | paletteVariant | mixMode | mixSeed | Expected Hash Prefix |
|--------|---------------|---------|---------|----------------------|
| 0 | 0 | 0 | 0 | `4de4d266...` |
| 0 | 4 | 1 | 123456789 | `bcdfcafb...` |
| 1 | 0 | 0 | 0 | `dd592895...` |
| 2 | 7 | 2 | 2654435769 | *(see golden.json)* |
| 3 | 8 | 0 | 0 | *(see golden.json)* |
| 4 | 1 | 2 | 654321 | *(see golden.json)* |
| 5 | 5 | 1 | 999999 | *(see golden.json)* |

**Pass condition:** Hash, byte length, and SVG prefix match exactly. Any regression means a change to the rendering logic, palette data, or fragment content.

---

## Check 2: Slot Order (Mixing) Equivalence

**Test:** `buildMixedSlotOrder matches golden snapshots for all fixed seeds and modes`

**Method:** For all combinations of:
- philId ∈ {0..5}
- mixMode ∈ {1 (SWAP), 2 (PERMUTE)}
- seed ∈ {111, 999, 2654435769, 42, 12345, 987654321}

The function `buildMixedSlotOrder(11, seed, mixMode)` is called and the resulting array is compared element-by-element against the golden snapshot.

**Pass condition:** Exact array equality for all 72 vectors (6 × 2 × 6). Any regression indicates a change to the XorShift32 PRNG or Fisher-Yates implementation — which would change rendered color assignments.

**Note on seed 0:** When `mixSeed == 0`, the `normalizeMixSeed` function substitutes `GOLDEN_MIX_SEED = 0x9e3779b9 = 2654435769`. This is tested explicitly via the `2654435769` seed entry.

---

## Check 3: Palette Bytes Equivalence

**Test:** `buildPackedPaletteBytes matches golden hashes for all 6 phils`

**Method:** For each philId ∈ {0..5}, `buildPackedPaletteBytes(philId)` is called and the SHA-256 hash of the resulting `Uint8Array` is compared against the golden snapshot.

The packed format is `slotCount × 9_variants × 3_bytes_per_color` per phil. The on-chain `PhilPalettes` contract stores exactly this byte sequence.

**Pass condition:** Exact hash match for all 6 phils. A regression means the deployed palette data would differ from what the tests expect.

---

## Check 4: Merkle Tree Equivalence

**Test:** `buildMerkleTree produces identical root and proofs for fixed address set`

**Method:** The Merkle tree is built from 5 fixed Ethereum addresses (Hardhat test accounts), and the following are compared to golden values:
- `tree.root` (bytes32)
- `tree.leaves` (array of bytes32 hashes)
- `tree.getProofByAddress(ADDRESSES[0]).proof`
- `tree.getProofByAddress(ADDRESSES[2]).proof`

**Pass condition:** Exact equality for root, leaves, and both proofs. A regression means the Merkle construction algorithm changed — which would invalidate all existing proofs.

**Addresses used:**
```
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266  (Hardhat #0)
0x70997970C51812dc3A010C7d01b50e0d17dc79C8  (Hardhat #1)
0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  (Hardhat #2)
0x90F79bf6EB2c4f870365E785982E1f101E93b906  (Hardhat #3)
0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65  (Hardhat #4)
```

---

## Check 5: Proof Hash Equivalence

**Test:** `computeClaimHash and computeFactHash match golden vectors`

**Method:** For 3 fixed addresses, using fixed parameters:
- `DROP_ID = 13`
- `CHAIN_ID = 31337`
- `PROGRAM_HASH = 0x4444...4444`
- `proofGate = 0x1111...1111`
- `philId=0, paletteVariant=0, mixMode=0, mixSeed=0, expiry=0`

The functions `computeClaimHash()` and `computeFactHash()` are called and results compared to golden snapshots.

**Pass condition:** Exact hex string match for all 6 hashes (3 addresses × 2 hashes). A regression means the proof computation changed — which would break all existing proofs even if Merkle membership is valid.

---

## Check 6: DSL Encode/Decode Roundtrip Stability

**Test:** `DSL encode/decode is stable across all fragment assets`

**Method:** For each DSL-encoded fragment in `buildOnchainRendererAssets()`:
1. Decode the bytes with `decodeDslV2(fragment.bytes)` — must equal `fragment.content` exactly.
2. Re-encode the decoded string with `encodeDslV2(decoded)` — resulting bytes must equal `fragment.bytes` exactly.

**Pass condition:** Both `decoded == content` and `re-encoded == bytes` for all DSL fragments (currently 40+ of 66 total). A regression means the DSL encoding format changed — which would invalidate all on-chain DSL-encoded fragments.

---

## ABI Compatibility

The replica does not change any contract source files. All ABI changes are therefore `none`. Specifically:

| Contract | Public/External Functions | ABI Status |
|----------|--------------------------|------------|
| `PhilTestMint` | `mint`, `tokenURI`, `royaltyInfo`, `name`, `symbol`, `totalSupply`, etc. | Unchanged |
| `ProofGateTest13` | `verifyAndConsume`, `nullifierUsed`, `computeClaimHash`, `computeExpectedFactHash` | Unchanged |
| `PhilRenderer` | `renderSvg`, `tokenURI`, `setGateway`, `setCompactTokenURI` | Unchanged |
| `PhilFragments` | `fragmentRange`, `chunkPtr`, `isDsl`, `offsets`, `chunkCount` | Unchanged |
| `PhilPalettes` | `paletteData`, `colorAt`, `palettePointer`, `slotCount` | Unchanged |
| `IProofGate.MintProof` | struct layout | Unchanged |

---

## Merkle/Proof Validity Vectors

### Valid Proofs (must succeed on-chain)

Tested in `test/allowlist-proof.contract.test.mjs`:
- Signer in allowlist with valid merkle proof + valid signature + unused nullifier → **PASS**

### Invalid Proofs (must revert on-chain)

Tested in `test/allowlist-proof.contract.test.mjs` and `test/error-cases.contract.test.mjs`:

| Case | Error |
|------|-------|
| Valid proof, replayed (nullifier already used) | `NullifierAlreadyUsed` |
| Address not in allowlist (outsider with empty proof) | `InvalidMerkleProof` |
| Valid proof but factHash tampered | `InvalidFactHash` |
| Valid merkle proof but signed by wrong key (non-recipient) | `InvalidSignature` |
| Proof with expiry in the past | `ProofExpired` |
| `verifyAndConsume` called directly (not via mint) | `UnauthorizedCaller` |
| Supply exhausted (14th mint attempt) | `SoldOut` |
| `philId >= 6` | `BadPhilId` |
| `paletteVariant >= 9` | `BadPaletteVariant` |
| `mixMode > 2` | `BadMixMode` |

---

## Determinism Harness

Since on-chain rendering depends only on `(philId, paletteVariant, mixMode, mixSeed)` and not on block state, timestamps, or msg.sender, strict exact-match snapshot testing is feasible without mocking.

The `renderPhil.mjs` renderer is a pure JS implementation of the on-chain `PhilRenderer.sol` logic. Test equivalence between them is validated in `test/frontend-selection.integration.test.mjs` which:

1. Deploys `PhilRenderer` on a local ganache node.
2. Calls `renderSvg()` on-chain.
3. Calls `renderPhil()` off-chain.
4. Compares the two outputs using `normalizeSvgForComparison()`.

---

## How to Regenerate Snapshots

If a safe, intentional change is made that affects outputs (e.g., palette data update):

1. Make the change in the original codebase.
2. Run: `node test/snapshots/gen_golden.mjs` in the original repo.
3. Copy the new `golden.json` to the replica's `test/snapshots/`.
4. Run `npm run test:equivalence` to confirm the replica matches.
5. Document the change in `CHANGELOG_REPLICA.md` with full justification.
6. Only proceed if `npm test` passes in both repos.
