# MIGRATION_NOTES

## What changed

- zkPhil now supports explicit provider modes through `HUMANITY_PROVIDER`.
- `HUMANITY_PROVIDER=mock` adds a DEV/TEST-ONLY mock-humanity flow.
- `HUMANITY_PROVIDER=local-credential` keeps the prior local credential-commitment flow.
- proving requests moved to `zkphil-local-proof-request-v3`.
- proof artifacts moved to `zkphil-stwo-proof-artifact-v3`.

## New preferred environment variables

- `HUMANITY_PROVIDER`
- `HUMANITY_BUNDLE_PATH`
- `CREDENTIAL_BUNDLE_PATH`
- `MOCK_HUMANITY_BUNDLE_PATH`
- `PROOF_CONTEXT`
- `VERIFIER_CONFIG_HASH`
- `FACT_REGISTRY`
- `FACT_REGISTRY_OPERATOR_KEY`
- `LOCAL_PROVER_HOST`
- `LOCAL_PROVER_PORT`
- `LOCAL_PROVER_MANIFEST`
- `LOCAL_PROVER_ENABLE_PROVE`
- `LOCAL_PROVER_ENABLE_VERIFY`

Legacy aliases such as `CONTEXT_ID`, `ELIGIBILITY_BUNDLE_PATH`, and `ELIGIBILITY_ROOT` are still tolerated in a few places as compatibility fallbacks.

## Mock-humanity additions

New bundle and request concepts:

- `mockHumanId`
- `mockHumanIdHash`
- `humanitySecret`
- `identitySource.kind = mock-human`
- `expectedHumanityCommitment`

## Still removed from the authorization path

- backend mint-signing authority
- `ALLOWLIST_SIGNER_KEY`
- allowlist slot language as the conceptual identity model

## Updated local mock-humanity workflow

Build the bundle:

```bash
node scripts/proofs/build_mock_humanity_bundle.mjs \
  --in fixtures/mock_humans.dev.json \
  --out artifacts/proofs/mock-humanity-bundle.json \
  --proofContext 13
```

Start the local prover service:

```bash
node scripts/proofs/local_prover_server.mjs
```

Execute the smoke flow after the chain and backend are running:

```bash
node scripts/local/mock_humanity_flow.mjs
```

## Request artifact

`zkphil-local-proof-request-v3`

Contains:

- `provider`
- `providerMode`
- `credentialSecret` or `humanitySecret`
- `commitmentWitness`
- `identitySource`
- `claimHash`
- `expectedFactHash`
- `expectedProofMetadata`
- `expectedIdentityNullifier`
- `expectedCredentialCommitment`
- `expectedHumanityCommitment` in mock mode
- `programHash`
- `proofContext`
- `expiry`

## Proof artifact

`zkphil-stwo-proof-artifact-v3`

Contains:

- original `request`
- `providerMode`
- `contractProof`
- `publicOutputs`
- `outputs`
- `proofStatus`
- `scarb` command metadata

## Current limitations

- Direct Ethereum-side verification of S-two proof artifacts is still not implemented here.
- The active verifier bridge is still fact-registry-based.
- World / World ID is still intentionally unimplemented.
- The local helper bootstrap may still need retries on some environments during the large local deploy path.
