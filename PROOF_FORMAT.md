# Proof Format

This repo uses a shared proof payload (`IProofGate.MintProof`) across:

- `PhilTestMint` minting (`verifyAndConsume`)
- `PhilAccountFactory` account creation (`verifyActionAndConsume`)
- `PhilAccount` execution 2FA (`verifyActionAndConsume` via factory relay)
- `Phil369CadenceMint` public and reserve minting (`verifyActionAndConsume`)

## On-chain proof struct

```solidity
struct MintProof {
  uint256 expiry;
  bytes32 factHash;
  bytes32[] merkleProof;
  bytes signature;
}
```

## Hashes

### Mint claim hash

`ProofGateTest13.computeClaimHash`:

```text
keccak256(abi.encode(
  DROP_ID,
  chainId,
  gateAddress,
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode,
  mixSeed,
  expiry
))
```

### Generic action claim hash

`ProofGateTest13.computeActionClaimHash`:

```text
keccak256(abi.encode(
  DROP_ID,
  chainId,
  gateAddress,
  recipient,
  actionType,
  actionHash,
  expiry
))
```

### Fact hash

```text
witnessHash = keccak256(abi.encodePacked(merkleProof))
factHash    = keccak256(abi.encode(PROGRAM_HASH, claimHash, MERKLE_ROOT, witnessHash))
```

### Nullifier

```text
nullifier = keccak256(abi.encodePacked(recipient, actionType, factHash))
```

Consumed once in `nullifierUsed`.

## Action type IDs

- `1` = mint
- `2` = account create
- `3` = account execute
- `4` = cadence mint
- `5` = cadence reserve mint

## Local proof package schema (`scripts/proofs/prove_local.mjs`)

```json
{
  "schema": "phil-proof-package-v2",
  "generatedAt": "ISO8601",
  "mode": "LOCAL_CAIRO_PROVER_SHAPE",
  "build": {
    "compiledWithScarb": true,
    "sourceHash": "0x...",
    "sierraPath": "cairo/target/dev/...sierra.json",
    "programHash": "0x...",
    "compiler": "scarb"
  },
  "network": {
    "chainId": 31337,
    "dropId": "13",
    "proofGate": "0x...",
    "merkleRoot": "0x...",
    "programHash": "0x..."
  },
  "proofs": [
    {
      "index": 0,
      "recipient": "0x...",
      "mintTo": "0x...",
      "philId": 0,
      "paletteVariant": 0,
      "mixMode": 1,
      "mixSeed": 3735928559,
      "expiry": 0,
      "merkleProof": ["0x..."],
      "signature": "0x...",
      "claimHash": "0x...",
      "actionHash": "0x...",
      "factHash": "0x...",
      "publicInputs": {
        "dropId": "13",
        "chainId": 31337,
        "proofGate": "0x...",
        "recipient": "0x...",
        "mintTo": "0x...",
        "actionType": "MINT",
        "actionHash": "0x...",
        "philId": 0,
        "paletteVariant": 0,
        "mixMode": 1,
        "mixSeed": 3735928559,
        "expiry": 0,
        "merkleRoot": "0x...",
        "claimHash": "0x...",
        "factHash": "0x..."
      },
      "localProof": {
        "prover": "local-deterministic-stark-shape",
        "cairoCompiler": "scarb",
        "proofDigest": "0x..."
      }
    }
  ]
}
```

## Parity tests

Hash parity is checked in:

- `test/equivalence-snapshots.test.mjs` (mint claim/fact vectors)
- `test/proof-parity.action.test.mjs` (mint + action claim/fact parity)
