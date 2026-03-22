# MIGRATION_NOTES

## What changed

- zkPhil now supports explicit provider modes through `HUMANITY_PROVIDER`.
- `HUMANITY_PROVIDER=mock` adds a DEV/TEST-ONLY mock-humanity flow.
- `HUMANITY_PROVIDER=local-credential` keeps the prior local credential-commitment flow.
- proving requests moved to `zkphil-local-proof-request-v3`.
- proof artifacts moved to `zkphil-stwo-proof-artifact-v3`.

## New preferred environment variables

- `HUMANITY_PROVIDER`
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
- `ART_BACKEND_MODE`
- `ART_BACKEND_MANIFEST_PATH`
- `NODE_BIN`

Removed from the active tracked workflow:

- `CONTEXT_ID`
- `ELIGIBILITY_BUNDLE_PATH`
- `ELIGIBILITY_ROOT`
- `HUMANITY_BUNDLE_PATH`

Retained because they still provide real compatibility value:

- `verify:sepolia` remains as a stricter alias for live Sepolia verification
- the database migration from `allowlist_entitlements` to `eligibility_entitlements` remains to protect existing local DBs

## Sepolia mutable-manifest cleanup

- mutable Stark and 4337 manifests now write `zkphil-mutable-stack-v1`
- app-specific Starknet unlock-sender bindings now live separately under `config/starknet-app-bindings/<network>.json`
- the current structured layout separates `components`, `dependencies`, `config`, and `status`
- `status:sepolia` still reads older flat manifests but labels them `legacy-flat-json` and surfaces alias-backed fields explicitly
- `verify:sepolia` can resolve `paymasterSigner` from a complete `deployments/4337_<chainId>.json` and now expects the Starknet unlock sender to be tracked in `config/starknet-app-bindings/<network>.json`
- `status:sepolia` and `verify:sepolia` can now resolve `EntryPoint v0.7` and `StarknetCore` from `config/stable-protocol-bindings/sepolia.json`
- the live Sepolia Stark-side identity/proof stack has now been redeployed into the current humanity-ready layout and tracked in `deployments/stark_11155111.json`
- the Sepolia 4337 layer still remains pending a real Starknet `PhilUnlockSender` deployment and binding manifest, so `verify:sepolia` continues to fail closed honestly
- `L2_UNLOCK_VERIFIER` is retained only as a compatibility alias while the active naming moves to `L2_UNLOCK_SENDER`

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
  --out generated/proofs/mock-humanity-bundle.json \
  --proofContext 13
```

Start the local prover service:

```bash
node scripts/proofs/local_prover_server.mjs
```

Execute the direct CLI flow after the chain and backend are running:

```bash
node scripts/local/mock_humanity_flow.mjs
```

Or run the single-command smoke path:

```bash
npm run smoke:local
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
- The local helper now hardens retries/readiness, but full S-two proving is still the slowest surface in the dev loop.
- Interactive shells pinned to Node 20 need the helper or an explicit `NODE_BIN`/`nvm use 22` to avoid backend native-module mismatches.
