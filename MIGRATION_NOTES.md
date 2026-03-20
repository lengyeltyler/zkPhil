# MIGRATION_NOTES

## What changed

- Phil mint authorization no longer depends on backend ECDSA signatures.
- The active identity gate now depends on `IHumanityVerifier`.
- The current verifier implementation is `FactRegistryHumanityVerifier`.
- `MintProof.signature` now encodes:
  - `abi.encode(uint256 identityNullifier, uint256 credentialCommitment)`
- the local proving request moved from list-era fields to:
  - `verifierConfigHash`
  - `credentialSecret`
  - `commitmentWitness`
  - `expectedIdentityNullifier`
  - `expectedCredentialCommitment`
- the current Cairo program moved to [`cairo/src/credential.cairo`](./cairo/src/credential.cairo)

## New preferred environment variables

- `PROOF_CONTEXT`
- `CREDENTIAL_BUNDLE_PATH`
- `VERIFIER_CONFIG_HASH`
- `FACT_REGISTRY`
- `FACT_REGISTRY_OPERATOR_KEY`
- `LOCAL_PROVER_HOST`
- `LOCAL_PROVER_PORT`
- `LOCAL_PROVER_MANIFEST`
- `LOCAL_PROVER_ENABLE_PROVE`
- `LOCAL_PROVER_ENABLE_VERIFY`

Legacy aliases such as `CONTEXT_ID`, `ELIGIBILITY_BUNDLE_PATH`, and `ELIGIBILITY_ROOT` are tolerated only as compatibility fallbacks in a few scripts.

## Removed from the production authorization path

- `ALLOWLIST_SIGNER`
- `ALLOWLIST_SIGNER_KEY`
- backend-issued mint signatures as a trust root

## Local proving workflow

Build the credential bundle:

```bash
node scripts/proofs/build_credential_bundle.mjs \
  --in credentials.json \
  --out artifacts/proofs/credential-bundle.json \
  --proofContext 13
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

`zkphil-local-proof-request-v2`

Contains:

- `provider`
- `kind`
- `claimKind`
- `recipient`
- `verifierConfigHash`
- `credentialSecret`
- `commitmentWitness`
- `claimHash`
- `expectedFactHash`
- `expectedProofMetadata`
- `expectedIdentityNullifier`
- `expectedCredentialCommitment`
- `programHash`
- `proofContext`
- `expiry`

### Proof artifact

`zkphil-stwo-proof-artifact-v2`

Contains:

- original `request`
- `contractProof`
- `publicOutputs`
- `outputs`
- `proofStatus`
- `scarb` command metadata

## Current limitation

- Direct Ethereum-side verification of S-two proof artifacts is still not implemented here.
- The active production bridge is fact-registry-based verification.
- Future proof-of-human providers such as World are intentionally not implemented yet.
