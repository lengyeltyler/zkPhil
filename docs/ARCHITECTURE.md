# Architecture

## Overview

zkPhil now models Phil minting as human-gated identity issuance.

- `PhilIdentityGate` handles caller authorization, claim binding, and one-nullifier-one-identity enforcement.
- `IHumanityVerifier` is the provider-agnostic proof verifier interface.
- `FactRegistryHumanityVerifier` is the current implementation.
- Cairo + S-two remain the proving layer.
- Ethereum remains the settlement and identity layer.
- the backend is not an authorization root

## Main components

- [`contracts/PhilIdentityGate.sol`](../contracts/PhilIdentityGate.sol)
- [`contracts/IHumanityVerifier.sol`](../contracts/IHumanityVerifier.sol)
- [`contracts/proofs/FactRegistryHumanityVerifier.sol`](../contracts/proofs/FactRegistryHumanityVerifier.sol)
- [`contracts/proofs/DevProofVerifier.sol`](../contracts/proofs/DevProofVerifier.sol)
- [`cairo/src/credential.cairo`](../cairo/src/credential.cairo)
- [`shared/proof/localStarkProver.mjs`](../shared/proof/localStarkProver.mjs)
- [`shared/proof/credentialBundle.mjs`](../shared/proof/credentialBundle.mjs)
- [`server-ts/src/routes/requestMint.ts`](../server-ts/src/routes/requestMint.ts)
- [`server-ts/src/routes/registerProof.ts`](../server-ts/src/routes/registerProof.ts)
- [`frontend/mint.js`](../frontend/mint.js)

## Current local provider

The repo ships one concrete local provider today:

- a recipient-bound credential secret
- a Cairo proof that derives a `credentialCommitment`
- a `verifierConfigHash` that is currently a Merkle commitment root
- an `identityNullifier` derived from secret + proof context + recipient + claim kind

This is intentionally an implementation bridge, not the long-term product abstraction.

## Identity issuance flow

1. The client authenticates with the backend.
2. `request-mint` selects an unused local credential witness from `CREDENTIAL_BUNDLE_PATH`.
3. The backend returns:
   - the contract proof payload `{ expiry, factHash, signature }`
   - a `provingRequest` artifact for local Cairo execution
4. The client sends `provingRequest` to the localhost prover.
5. Cairo runs locally and emits `zkphil-stwo-proof-artifact-v2`.
6. The client submits the resulting proof payload to `/register-proof`.
7. `FactRegistryHumanityVerifier` checks the fact hash against the registry.
8. `PhilIdentityGate` consumes the returned identity nullifier.

## Public outputs

The current Cairo provider emits:

1. `verifier_config_hash`
2. `proof_context`
3. `recipient`
4. `claim_hash_hi`
5. `claim_hash_lo`
6. `identity_nullifier`
7. `credential_commitment`
8. `claim_kind`

`MintProof.signature` now carries:

```text
abi.encode(uint256 identityNullifier, uint256 credentialCommitment)
```

## Trust model

Removed:

- backend mint-signing authority
- `ALLOWLIST_SIGNER_KEY`
- allowlist slot consumption as the conceptual authorization model

Retained:

- backend auth/session handling
- deterministic `mintTo` binding
- onchain nullifier consumption
- local/dev fact registration on `31337`

## Future humanity providers

The insertion point for future providers is `IHumanityVerifier`.

Future implementations can support:

- World / World ID style proof-of-human systems
- other proof-of-personhood systems
- migration credentials for early users
- internal development providers

Those providers are intentionally not implemented in this repo yet.

## Verification path

Production/public chains:

- use an external fact registry
- rely on the local prover plus the registry bridge, not on any backend signer

Local dev (`31337`):

- use `DevProofVerifier`
- use `POST /register-proof` with `FACT_REGISTRY_OPERATOR_KEY`

## Current limitation

- This repo still does not perform direct onchain Ethereum verification of S-two proofs.
- The active production path is fact-registry-based verification.
