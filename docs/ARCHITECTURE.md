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
- Sepolia protocol bindings live in [`config/stable-protocol-bindings/sepolia.json`](../config/stable-protocol-bindings/sepolia.json).
- Those stable protocol bindings are the intended reuse base for `EntryPoint v0.7` and `StarknetCore`.

Tracked app-specific Starknet bindings:

- the Starknet unlock sender is tracked separately in [`config/starknet-app-bindings/`](../config/starknet-app-bindings/)
- that manifest is intentionally not part of the stable protocol layer because `PhilUnlockSender` is app-specific mutable infrastructure
- the Starknet app binding records the Starknet sender felt, the bound L1 `PhilUnlockInbox`, and the current unlock payload format

Mutable, redeployable infrastructure:

- provider-aware identity core manifests live under `deployments/stark_<chainId>.json`
- Starknet app binding manifests live under `config/starknet-app-bindings/<network>.json`
- 4337/account manifests live under `deployments/4337_<chainId>.json`
- local art bootstrap manifests live under `deployments/art_<chainId>.json`
- current deploy scripts write Sepolia/local mutable manifests as `zkphil-mutable-stack-v1`
- those manifests separate `components`, `dependencies`, `config`, and computed `status`
- status tooling still reads older flat manifests, but marks them as `legacy-flat-json` and surfaces alias resolution instead of treating them as fully current
- on Sepolia today, the Stark-side mutable stack is deployed and tracked, the reusable protocol bindings are tracked, but the Starknet app binding and the L1 4337/account layer are still intentionally incomplete until a real Starknet `PhilUnlockSender` is deployed and tracked

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
- [`contracts/PhilUnlockInbox.sol`](../contracts/PhilUnlockInbox.sol)
- [`cairo/src/credential.cairo`](../cairo/src/credential.cairo)
- [`starknet/src/lib.cairo`](../starknet/src/lib.cairo)
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

## Starknet unlock sender path

- `PhilUnlockInbox` consumes Starknet L2->L1 messages through the reused `StarknetCore` contract on L1.
- The app-specific Starknet sender is `PhilUnlockSender`, now implemented in [`starknet/src/lib.cairo`](../starknet/src/lib.cairo).
- `PhilUnlockSender` is a minimal Starknet contract that:
  - stores an owner Starknet account
  - stores the bound L1 `PhilUnlockInbox` recipient
  - emits unlock ticket payloads toward L1
- The current unlock payload format is `zkphil-unlock-ticket-v1`:
  - `[vault, nonce, validAfter, validUntil, scope, constraintsHashHi128, constraintsHashLo128]`
- `PhilUnlockInbox` reconstructs the original `bytes32 constraintsHash` from those two Starknet-safe 128-bit words before storing the latest ticket for a vault.
- This Starknet sender path is only needed for the 4337/account unlock flow; the Phil identity proof/nullifier flow remains L1 + Cairo/S-two + fact-registry based.

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
- `npm run smoke:local` wraps helper bring-up, readiness checks, the mock-humanity flow, deterministic assertions, and teardown
- `npm run status:sepolia` reports the stable reuse boundary and mutable Sepolia manifests in one place
- `npm run status:sepolia` now classifies the mutable Sepolia layers as `complete`, `partial`, `missing`, or `placeholder-configured`
- `npm run verify:sepolia` can resolve `paymasterSigner` and `l2UnlockSender` from the mutable 4337 manifest when that manifest is complete
- `npm run status:sepolia` and `npm run verify:sepolia` can already resolve `EntryPoint v0.7` and `StarknetCore` from `config/stable-protocol-bindings/sepolia.json`
- `npm run status:sepolia` now reports the Starknet app binding layer separately from both the reusable protocol bindings and the mutable L1 4337 manifest
- `npm run verify:sepolia` now fails closed unless the Starknet app binding manifest exists, tracks the unlock sender and L1 recipient, and a Starknet RPC is available for live sender inspection
- `L2_UNLOCK_VERIFIER` is now treated as a legacy compatibility alias for `L2_UNLOCK_SENDER`, which is the Starknet L2 sender felt consumed by `PhilUnlockInbox`
- local helper runs pin Node 22 for backend/prover/bootstrap work even when the interactive shell defaults to an older Node
- proof bundles live under `generated/proofs/` so compiler output cleanup does not erase them

## Current limitations

- Direct Ethereum-side verification of S-two proofs is still not implemented.
- The active bridge is still fact-registry-based.
- World / World ID remains intentionally unimplemented.
- `HUMANITY_PROVIDER=mock` is restricted to local development and testing.
- `PhilUnlockSender` is intentionally minimal and owner-gated today; it is enough to make the Starknet sender path real and testable, but it is not yet a production-ready multi-factor policy engine.
