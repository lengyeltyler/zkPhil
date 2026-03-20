# MIGRATION_NOTES

## What changed

- Mint authorization no longer depends on backend ECDSA signatures.
- The core model is now eligibility-based identity issuance, not allowlist/Test13 membership.
- `MintProof.signature` now carries ABI-encoded proof metadata:
  - `abi.encode(uint256 nullifier, uint256 credentialSlot, uint256 credentialLeaf)`
- `request-mint` now returns:
  - `proof`
  - `provingRequest`
- The frontend/browser mint flow now calls a localhost prover service.
- `PhilIdentityGate` verifies fact validity plus nullifier replay protection.
- `PhilPaymaster` was updated to the new 96-byte proof-metadata format.

## New environment variables

- `CONTEXT_ID`
- `ELIGIBILITY_BUNDLE_PATH`
- `FACT_REGISTRY`
- `FACT_REGISTRY_OPERATOR_KEY` for local `31337`
- `LOCAL_PROVER_HOST`
- `LOCAL_PROVER_PORT`
- `LOCAL_PROVER_MANIFEST`
- `LOCAL_PROVER_ENABLE_PROVE`
- `LOCAL_PROVER_ENABLE_VERIFY`

## Removed from the production authorization path

- `ALLOWLIST_SIGNER`
- `ALLOWLIST_SIGNER_KEY`

## Local proving workflow

Build the eligibility bundle:

```bash
node scripts/proofs/build_eligibility_bundle.mjs \
  --in eligibility.json \
  --out artifacts/proofs/eligibility-bundle.json \
  --contextId 13
```

Start the local prover service:

```bash
node scripts/proofs/local_prover_server.mjs
```

Generate a proof artifact from a saved request:

```bash
node scripts/proofs/prove_local.mjs \
  --request artifacts/proofs/request.json \
  --out artifacts/proofs/local-proof-artifact.json \
  --prove
```

Optional proof verification:

```bash
node scripts/proofs/prove_local.mjs \
  --request artifacts/proofs/request.json \
  --out artifacts/proofs/local-proof-artifact.json \
  --prove --verify
```

## Artifact formats

### Request artifact

`zkphil-local-proof-request-v1`

Contains:

- `kind`
- `claimKind`
- `recipient`
- `eligibilityRoot`
- `credentialSlot`
- `secret`
- `siblings`
- `pathIndices`
- `claimHash`
- `expectedFactHash`
- `expectedProofMetadata`
- `expectedNullifier`
- `expectedLeaf`
- `programHash`
- `contextId`
- `expiry`

### Proof artifact

`zkphil-stwo-proof-artifact-v1`

Contains:

- original `request`
- `contractProof`
- `publicOutputs`
- `outputs`
- `proofStatus`
- `scarb` command metadata

## Current limitation

- This repo does not yet provide direct Ethereum-side verification of S-two proof artifacts.
- The implemented production-compatible bridge is fact-registry-based verification.
- Local proof registration is fully wired for `31337` via `DevProofVerifier`.
- Future human-verification providers are not implemented yet; the current insertion point is the eligibility root / credential preparation layer.
