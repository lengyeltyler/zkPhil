# SEPOLIA_STATUS_CLEANUP_REPORT

## What was cleaned up

- Sepolia mutable deployment manifests now have a shared normalization layer in `shared/deploy/mutableStackManifest.mjs`.
- current deploy writers for `scripts/deploy_stark.mjs` and `scripts/deploy_4337.mjs` now emit `zkphil-mutable-stack-v1`.
- the mutable manifest shape is now explicit:
  - `components`
  - `dependencies`
  - `config`
  - `status`
- `scripts/sepolia/status.mjs` now reports mutable-stack classification, alias resolution, legacy leftovers, placeholder config, and blocker details.
- `scripts/verify_sepolia_bindings.mjs` now resolves mutable 4337 config from the manifest when available instead of requiring every live value to come from env.

## Manifest/config structure changes

Stable reused infrastructure stays here:

- `config/stable-art-backends/sepolia.json`

Mutable Sepolia infrastructure stays here:

- `deployments/stark_11155111.json`
- `deployments/4337_11155111.json`

Current structured mutable manifests written by the repo use:

- `schema = zkphil-mutable-stack-v1`
- `deploymentType = mutable`
- `stack = identity-proof | account-abstraction`
- `components`
- `dependencies`
- `config`
- `status`

Backward compatibility remains:

- older flat manifests are still readable
- top-level compatibility fields are still emitted for existing readers
- status tooling now labels old manifests as `legacy-flat-json` instead of treating them as current

## Reused vs mutable

Reused Sepolia infrastructure:

- `PhilSVGStorage`
- `PhilLayerRegistry`
- `PhilNFT`

Mutable Sepolia identity/proof infrastructure:

- `PhilIdentityGate`
- `PhilIdentityMint`
- `humanityVerifier`
- linked `factRegistry`

Mutable Sepolia 4337/account infrastructure:

- `PhilAccountFactory`
- `PhilPaymaster`
- `PhilUnlockInbox`
- linked `PhilIdentityMint`
- linked `PhilIdentityGate`
- linked `EntryPoint`
- config for `paymasterSigner`, `starknetCore`, and `l2UnlockVerifier`

## Current actual Sepolia state

Based on `npm run status:sepolia` in the current repo/worktree:

- reused stable art/data state: `complete`
  - `config/stable-art-backends/sepolia.json` exists
  - verification metadata is present and marked verified
- mutable identity/proof state: `partial`
  - `deployments/stark_11155111.json` exists
  - it is still `legacy-flat-json`
  - `PhilIdentityGate` resolves only via `ProofGate`
  - `PhilIdentityMint` resolves only via `PhilTestMint`
  - `humanityVerifier` is missing
  - `factRegistry` is missing
  - legacy fields still present:
    - `ProofGateTest13`
    - `PhilTestMint`
    - `dropId`
    - `allowlistSigner`
  - stale legacy config still present:
    - `ProofMode=BACKEND_SIGNER_ONLY`
- mutable 4337/account state: `missing`
  - `deployments/4337_11155111.json` does not exist in the current repo state
- live verification state: `skipped`
  - `PHIL_ACCOUNT_FACTORY` and `PHIL_PAYMASTER` cannot be resolved without a mutable 4337 manifest or explicit env overrides
  - `STARKNET_CORE` and `L2_UNLOCK_VERIFIER` remain placeholder/missing in the current repo env/config picture

## Placeholder values still allowed

These remain intentionally placeholder-capable because the mutable Sepolia 4337 layer is not yet fully tracked in-repo:

- `STARKNET_CORE`
- `L2_UNLOCK_VERIFIER`
- `PAYMASTER_SIGNER` when only a private key or future 4337 manifest is expected

This is intentional for now because:

- the repo should not fabricate public-chain addresses
- the current Sepolia mutable 4337 stack is not fully deployed/tracked
- status should surface the gap, not hide it

## What remains incomplete

- `deployments/stark_11155111.json` still needs to be rewritten from an actual current deployment so it tracks:
  - `PhilIdentityGate`
  - `PhilIdentityMint`
  - `humanityVerifier`
  - `factRegistry`
  - current provider/fact-bridge config
- `deployments/4337_11155111.json` still needs to be created from a real tracked Sepolia 4337 deployment
- live Sepolia verification will remain skipped or fail closed until the mutable 4337 manifest and unlock config are real

## Why the state is still incomplete

- this cleanup pass intentionally did not invent or backfill fake public-chain addresses
- the goal was to make the current Sepolia story legible and truthful
- the repo now distinguishes cleanly between:
  - stable reused art/data
  - mutable identity/proof state
  - mutable 4337/account state
  - missing vs partial vs placeholder-configured vs complete
