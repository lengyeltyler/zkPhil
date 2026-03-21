# Architecture

## Overview

zkPhil now has a provider-aware humanity architecture with a shared gate:

- `PhilIdentityGate` handles caller authorization, claim binding, nullifier spend tracking, and replay protection.
- `IHumanityVerifier` is the provider-agnostic verifier interface.
- the active bridge remains fact-registry-based.
- Cairo + S-two remain the proving layer.
- the backend is a request-preparation helper, not the authorization root.

## Infrastructure split

Stable, reused infrastructure:

- Sepolia trait/data contracts live in [`config/stable-art-backends/sepolia.json`](../config/stable-art-backends/sepolia.json).
- Those stable addresses are the intended reuse base for `PhilSVGStorage`, `PhilLayerRegistry`, and `PhilNFT`.

Mutable, redeployable infrastructure:

- provider-aware identity core manifests live under `deployments/stark_<chainId>.json`
- 4337/account manifests live under `deployments/4337_<chainId>.json`
- local art bootstrap manifests live under `deployments/art_<chainId>.json`

Deployment modes:

- `ART_BACKEND_MODE=reuse-stable` for public-chain reuse of stable art/data infrastructure
- `ART_BACKEND_MODE=reuse-existing-data` for local manifest reuse
- `ART_BACKEND_MODE=deploy-local` for a fresh local art bootstrap

## Provider modes

### `HUMANITY_PROVIDER=local-credential`

Production-oriented bridge mode for the existing local credential-commitment flow.

- verifier contract: `FactRegistryHumanityVerifier`
- proof request provider: `local-credential-commitment`
- identity subject: recipient wallet
- commitment witness: recipient-bound credential commitment

### `HUMANITY_PROVIDER=mock`

DEV/TEST-ONLY mock-humanity mode.

- verifier contract: `MockHumanityVerifier`
- proof request provider: `mock-humanity`
- identity subject: deterministic `mockHumanIdHash`
- claim hash still binds the recipient and `mintTo`
- one mock human should consume one Phil identity nullifier

This is not World ID.
This does not call any external proof-of-human service.

## Main components

- [`contracts/PhilIdentityGate.sol`](../contracts/PhilIdentityGate.sol)
- [`contracts/IHumanityVerifier.sol`](../contracts/IHumanityVerifier.sol)
- [`contracts/proofs/FactRegistryHumanityVerifier.sol`](../contracts/proofs/FactRegistryHumanityVerifier.sol)
- [`contracts/proofs/MockHumanityVerifier.sol`](../contracts/proofs/MockHumanityVerifier.sol)
- [`contracts/proofs/DevProofVerifier.sol`](../contracts/proofs/DevProofVerifier.sol)
- [`cairo/src/credential.cairo`](../cairo/src/credential.cairo)
- [`shared/proof/localStarkProver.mjs`](../shared/proof/localStarkProver.mjs)
- [`shared/proof/credentialBundle.mjs`](../shared/proof/credentialBundle.mjs)
- [`shared/proof/mockHumanityBundle.mjs`](../shared/proof/mockHumanityBundle.mjs)
- [`server-ts/src/lib/eligibility.ts`](../server-ts/src/lib/eligibility.ts)
- [`server-ts/src/routes/requestMint.ts`](../server-ts/src/routes/requestMint.ts)
- [`server-ts/src/routes/registerProof.ts`](../server-ts/src/routes/registerProof.ts)
- [`frontend/mint.js`](../frontend/mint.js)

## Proof request model

The backend returns `zkphil-local-proof-request-v3`.

Shared fields:

- `provider`
- `providerMode`
- `claimHash`
- `verifierConfigHash`
- `commitmentWitness`
- `expectedFactHash`
- `expectedProofMetadata`
- `expectedIdentityNullifier`
- `expectedCredentialCommitment`
- `programHash`
- `proofContext`

Local-credential mode adds:

- `credentialSecret`
- `identitySource.kind = recipient`

Mock-humanity mode adds:

- `humanitySecret`
- `mockHumanId`
- `mockHumanIdHash`
- `identitySource.kind = mock-human`
- `expectedHumanityCommitment`

## Cairo public outputs

The current Cairo provider still emits eight public outputs:

1. `verifier_config_hash`
2. `proof_context`
3. `recipient`
4. `claim_hash_hi`
5. `claim_hash_lo`
6. `identity_nullifier`
7. `credential_commitment`
8. `claim_kind`

In mock-humanity mode, output slot `7` carries the mock-humanity commitment.
The output shape stays stable so the fact-registry bridge does not change.

## End-to-end local mock-humanity flow

1. The user authenticates with the backend.
2. The frontend exposes available mock humans from backend status / eligibility.
3. `request-mint` or account-create action request returns a provider-aware proving request.
4. The local prover serializes the Cairo input as an outer `Array<felt252>`, executes locally, and emits `zkphil-stwo-proof-artifact-v3`.
5. `/register-proof` registers the resulting fact in the local `DevProofVerifier`.
6. `MockHumanityVerifier` checks the registered fact.
7. `PhilIdentityGate` consumes the identity nullifier.
8. `PhilIdentityMint` mints to the requested smart account.

## Trust model

Removed:

- backend mint-signing authority
- allowlist slot language as the product authorization model
- any claim that mock-humanity mode is production verification

Retained:

- backend auth/session handling
- deterministic `mintTo` binding
- fact-registry bridge verification
- onchain nullifier consumption

Dev helper behavior:

- `scripts/run_local_e2e.sh` now performs readiness checks for RPC, prover, backend, Stark core, 4337, and the art backend
- local helper runs pin Node 22 for backend/prover/bootstrap work even when the interactive shell defaults to an older Node
- proof bundles live under `generated/proofs/` so compiler output cleanup does not erase them

## Current limitations

- Direct Ethereum-side verification of S-two proofs is still not implemented.
- The active bridge is still fact-registry-based.
- World / World ID remains intentionally unimplemented.
- `HUMANITY_PROVIDER=mock` is restricted to local development and testing.
