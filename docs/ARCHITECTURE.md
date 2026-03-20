# Architecture

## Overview

zkPhil stays Ethereum-native.

- Cairo is the proving layer.
- S-two / `scarb prove` is the local proving workflow.
- Solidity does not trust a backend signer anymore.
- `PhilIdentityGate` accepts only fact-registry-backed proofs whose public outputs bind the recipient, context, claim hash, nullifier, credential slot, and credential leaf.

## Main components

- [`cairo/src/eligibility.cairo`](../cairo/src/eligibility.cairo): recipient-bound eligibility program.
- [`shared/proof/localStarkProver.mjs`](../shared/proof/localStarkProver.mjs): deterministic claim hash, nullifier, leaf, fact hash, and proof metadata helpers shared by server, client, and tests.
- [`shared/proof/eligibilityBundle.mjs`](../shared/proof/eligibilityBundle.mjs): bundle builder for recipient/credential witnesses.
- [`contracts/PhilIdentityGate.sol`](../contracts/PhilIdentityGate.sol): fact-backed identity gate.
- [`contracts/proofs/DevProofVerifier.sol`](../contracts/proofs/DevProofVerifier.sol): local-only fact registry for chain `31337`.
- [`server-ts/src/routes/requestMint.ts`](../server-ts/src/routes/requestMint.ts): returns local proving inputs instead of backend signatures.
- [`server-ts/src/routes/registerProof.ts`](../server-ts/src/routes/registerProof.ts): dev-only fact registration bridge.
- [`frontend/mint.js`](../frontend/mint.js): requests eligibility, runs local proving, registers the resulting fact, and finishes identity issuance.
- [`scripts/proofs/local_prover_server.mjs`](../scripts/proofs/local_prover_server.mjs): localhost prover wrapper for the browser flow.

## Identity issuance flow

1. The client authenticates with the backend as before.
2. `request-mint` selects an unused eligibility credential from `ELIGIBILITY_BUNDLE_PATH`.
3. The backend returns:
   - the existing `proof` shape `{ expiry, factHash, signature }`
   - a `provingRequest` payload for local Cairo execution/proving
4. The client sends `provingRequest` to the localhost prover.
5. The prover runs Cairo locally and emits `zkphil-stwo-proof-artifact-v1`.
6. The client submits the resulting `proof` to `/register-proof`.
7. `PhilIdentityGate` verifies:
   - the caller is authorized
   - the proof metadata decodes
   - the expected fact hash matches the claim
   - the fact registry marks the fact valid
   - the nullifier was not previously consumed

## Public outputs and proof metadata

The Cairo program emits these public outputs:

1. `eligibility_root`
2. `context_id`
3. `recipient`
4. `claim_hash_hi`
5. `claim_hash_lo`
6. `nullifier`
7. `credential_slot`
8. `credential_leaf`
9. `claim_kind`

`MintProof.signature` is now opaque ABI-encoded metadata:

```text
abi.encode(uint256 nullifier, uint256 credentialSlot, uint256 credentialLeaf)
```

This preserves the existing Solidity struct surface while removing any signer-based trust assumption.

## Trust model

Removed:

- backend private key as mint-authority root of trust
- `ALLOWLIST_SIGNER_KEY` as proof issuer

Retained:

- backend session/auth handling
- backend witness distribution
- deterministic `mintTo` binding
- nullifier-based replay protection
- credential reservation via issued-proof tracking plus onchain nullifier consumption

## Future credential sources

The eligibility architecture is intentionally generic. The contract and proving pipeline are designed so the eligibility root can later represent:

- a legacy recipient eligibility list
- a proof-of-human registry
- a credential registry from another non-custodial source

That future work only needs a new credential source and Cairo input preparation path; it does not require returning to backend-signed authorization.

## Verification path

Production/public chains:

- use an external fact registry
- the proving authority is the local prover plus the fact-registration path, not the backend signer

Local dev (`31337`):

- use `DevProofVerifier`
- use `POST /register-proof` with `FACT_REGISTRY_OPERATOR_KEY`

Current limitation:

- this repo does not ship a direct onchain S-two verifier for Ethereum.
- the realistic bridge implemented here is fact-registry-based verification.
