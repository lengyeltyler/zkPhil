# Phil Test13 Cairo STARK Program

This directory contains the Cairo 1.x program for generating STARK proofs for the Phil Test13 allowlist mint.

## Overview

The program proves:
1. Knowledge of a `secret` whose hash exists in the allowlist Merkle tree
2. Correct computation of a `nullifier` to prevent replay attacks
3. Binding to a specific `recipient` and `drop_id`

## Building

### Prerequisites

Install Scarb (Cairo package manager):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh
```

### Build

```bash
cd cairo
scarb build
```

### Test

```bash
scarb test
```

## Program Outputs

The program outputs 6 felt252 values:

| Index | Name | Purpose |
|-------|------|---------|
| 0 | root | Merkle root (verified against contract) |
| 1 | drop_id | Drop identifier (verified against contract) |
| 2 | recipient | Recipient address (verified against mint params) |
| 3 | nullifier | Prevents replay (burned on mint) |
| 4 | leaf | Debug: computed leaf hash |
| 5 | idx | Debug: tree depth |

## Cryptographic Model

### Leaf Computation
```
leaf = pedersen(DOMAIN_LEAF, secret)
```
where `DOMAIN_LEAF = 1`

### Nullifier Computation
```
nullifier = pedersen(DOMAIN_NULL, pedersen(secret, pedersen(drop_id, recipient)))
```
where `DOMAIN_NULL = 2`

This nullifier formula ensures:
- Each secret can only be used once per drop
- The nullifier is bound to the specific recipient
- The nullifier cannot be computed without knowing the secret

## Atlantic Integration

### Submitting to Atlantic

1. Build the program: `scarb build`
2. Submit the compiled Sierra to Atlantic API
3. Provide inputs (secret, proof, root, drop_id, recipient)
4. Wait for proof generation
5. Retrieve factHash and outputs

### Fact Hash Computation

On Ethereum, the factHash is computed as:
```solidity
bytes32 outputHash = keccak256(abi.encodePacked(outputs));
bytes32 factHash = keccak256(abi.encode(PROGRAM_HASH, outputHash));
```

The contract verifies this factHash against Atlantic Satellite.

## Local Testing

Create a test input file `test_input.json`:
```json
{
  "secret": "12345",
  "siblings": [],
  "path_indices": [],
  "root": "<computed_leaf>",
  "drop_id": "1",
  "recipient": "0x1234567890abcdef"
}
```

Run with:
```bash
scarb cairo-run --available-gas=2000000000 < test_input.json
```

## Security Notes

- **Secret Management**: Secrets must NEVER leave the server
- **Nullifier Privacy**: Nullifiers are deterministic but don't reveal the secret
- **Domain Separation**: DOMAIN_LEAF and DOMAIN_NULL prevent cross-purpose hash collisions
