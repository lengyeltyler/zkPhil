# Proof-as-2FA Bindings

This repo uses one proof gate (`ProofGateTest13`) for mint, account-create, and account-execute.

## Common proof payload

`IProofGate.MintProof`:

- `expiry`
- `factHash`
- `merkleProof`
- `signature`

## Identity binding

Identity is bound by both:

- Merkle leaf check: `leaf = keccak256(abi.encodePacked(recipient))`
- Signature check: recovered signer over `claimHash` must equal `recipient`

## Action binding

### Mint

`ProofGateTest13.verifyAndConsume(...)` computes:

- `mintActionHash = keccak256(abi.encode(mintTo, philId, paletteVariant, mixMode, mixSeed))`
- `claimHash = keccak256(abi.encode(DROP_ID, chainId, gate, recipient, mintTo, philId, paletteVariant, mixMode, mixSeed, expiry))`

### Account create

`PhilAccountFactory.createPhilAccount(...)` computes:

- `actionHash = keccak256(abi.encode(factory, owner, starkPubKeyX))`
- Gate checks `verifyActionAndConsume(owner, ACTION_ACCOUNT_CREATE, actionHash, proof)`

### Account execute

`PhilAccount.submitExecutionProof(...)` computes:

- `actionHash = keccak256(abi.encode(account, recipient, target, value, keccak256(data)))`
- Factory relays to gate via `consumeExecutionProof(...)`
- Gate checks `verifyActionAndConsume(recipient, ACTION_ACCOUNT_EXECUTE, actionHash, proof)`

## Nullifier / replay binding

Gate nullifier:

- `nullifier = keccak256(abi.encodePacked(recipient, actionType, factHash))`

This is consumed once (`nullifierUsed[nullifier] = true`) to prevent replay.

## Fact hash binding

For all paths:

- `witnessHash = keccak256(abi.encodePacked(merkleProof))`
- `expectedFactHash = keccak256(abi.encode(PROGRAM_HASH, claimHash, MERKLE_ROOT, witnessHash))`
- Require `expectedFactHash == proof.factHash`

## JS ↔ Solidity parity

Parity coverage is enforced in tests with matching implementations in:

- Solidity: `ProofGateTest13.computeClaimHash`, `computeActionClaimHash`, `computeExpectedFactHash`
- JS: `shared/proof/localStarkProver.mjs` (`computeClaimHash`, `computeActionClaimHash`, `computeFactHash`)
