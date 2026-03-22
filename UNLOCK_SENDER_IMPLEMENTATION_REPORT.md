# Unlock Sender Implementation Report

## Before This Pass

- `L2_UNLOCK_VERIFIER` had already been renamed conceptually to `L2_UNLOCK_SENDER`.
- The repo correctly understood that the missing public-chain dependency was an app-specific Starknet sender felt consumed by `PhilUnlockInbox`.
- That sender still did not exist in tracked repo code, deployment tooling, or Sepolia bindings.
- The L1 inbox payload was still mock-friendly rather than Starknet-field-safe because it tried to send the entire `bytes32 constraintsHash` as one `uint256`.

## What The Starknet-Side Unlock Sender Actually Is

- The current architecture now defines the app-side sender as `PhilUnlockSender`, a dedicated Starknet contract implemented in [`starknet/src/lib.cairo`](./starknet/src/lib.cairo).
- `PhilUnlockSender` is the Starknet contract that emits L2->L1 unlock ticket messages toward `PhilUnlockInbox`.
- It is app-specific mutable infrastructure, not a reused protocol binding.
- Its current role is narrowly scoped to the 4337/account unlock path.

## Implemented In This Pass

- Added a dedicated Starknet Scarb package under [`starknet/`](./starknet/).
- Added `PhilUnlockSender` with:
  - owner-gated unlock emission
  - tracked L1 recipient binding
  - Starknet `send_message_to_l1_syscall`
- Added a tracked Starknet app-binding layer:
  - [`config/starknet-app-bindings/README.md`](./config/starknet-app-bindings/README.md)
  - [`shared/deploy/starknetAppBindings.mjs`](./shared/deploy/starknetAppBindings.mjs)
- Added Starknet build/deploy/update scripts:
  - [`scripts/starknet/build_unlock_sender.mjs`](./scripts/starknet/build_unlock_sender.mjs)
  - [`scripts/starknet/deploy_unlock_sender.mjs`](./scripts/starknet/deploy_unlock_sender.mjs)
  - [`scripts/starknet/set_unlock_sender_recipient.mjs`](./scripts/starknet/set_unlock_sender_recipient.mjs)
- Added Starknet felt validation helpers in [`shared/deploy/starknetFelt.mjs`](./shared/deploy/starknetFelt.mjs).
- Tightened the L1 bridge payload:
  - `PhilUnlockInbox` now encodes `[vault, nonce, validAfter, validUntil, scope, constraintsHashHi128, constraintsHashLo128]`
  - `MockStarknetCore` now rejects payload values outside the Starknet field prime

## Codepaths Touched

- Solidity bridge:
  - [`contracts/PhilUnlockInbox.sol`](./contracts/PhilUnlockInbox.sol)
  - [`contracts/mocks/MockStarknetCore.sol`](./contracts/mocks/MockStarknetCore.sol)
- Sepolia status/verification:
  - [`scripts/sepolia/status.mjs`](./scripts/sepolia/status.mjs)
  - [`scripts/verify_sepolia_bindings.mjs`](./scripts/verify_sepolia_bindings.mjs)
- Sepolia 4337 deploy path:
  - [`scripts/deploy_4337.mjs`](./scripts/deploy_4337.mjs)
- Manifest/config helpers:
  - [`shared/deploy/mutableStackManifest.mjs`](./shared/deploy/mutableStackManifest.mjs)
  - [`shared/deploy/unlockSenderArtifacts.mjs`](./shared/deploy/unlockSenderArtifacts.mjs)

## Retained For Compatibility

- `L2_UNLOCK_VERIFIER` remains accepted as an env compatibility alias only.
- `PhilUnlockInbox.l2VerifierAddress()` remains as a legacy getter alias for older tooling.

## Removed Or Corrected Conceptually

- The remaining public-chain blocker is no longer treated as a vague verifier placeholder.
- The repo now treats the missing Starknet sender as a concrete missing deployment/binding layer.
- The inbox payload shape now matches a Starknet-safe message format instead of a mock-only `bytes32` single-word shortcut.

## Deployment Result

- Real Starknet Sepolia unlock-sender deployment completed in this pass: no.
- Real Sepolia 4337/account deployment completed in this pass: no.

## Why Live Deployment Still Did Not Complete

The repo now has the correct code and deployment path, but this machine still lacks Starknet deployment credentials:

- `npm run starknet:deploy-unlock-sender` failed with:
  - `STARKNET_RPC_URL or STARKNET_RPC_URL_SEPOLIA must be set explicitly.`

Without a real Starknet sender deployment and tracked `config/starknet-app-bindings/sepolia.json`, the L1 4337 deployment remains blocked honestly.

## Verification Result

- `npm run status:sepolia`: passes and now reports the Starknet app binding layer explicitly.
- `npm run verify:sepolia`: still fails closed honestly.

Current live blockers reported by the repo:

- missing `config/starknet-app-bindings/sepolia.json`
- missing `deployments/4337_11155111.json`
- unresolved `L2_UNLOCK_SENDER`
- no Starknet RPC/account credentials to deploy `PhilUnlockSender`

## Remaining Blockers

1. Provide real Starknet Sepolia deployment credentials:
   - `STARKNET_RPC_URL` or `STARKNET_RPC_URL_SEPOLIA`
   - `STARKNET_ACCOUNT_ADDRESS`
   - `STARKNET_PRIVATE_KEY`
2. Run `npm run starknet:deploy-unlock-sender`.
3. Run the L1 Sepolia 4337 deployment with the resulting Starknet app binding present.
4. Run `npm run starknet:set-unlock-recipient` so the Starknet sender points at the deployed `PhilUnlockInbox`.
5. Re-run `npm run verify:sepolia`.

## Good Stopping Point

The repo now has:

- a concrete Starknet-side unlock sender implementation
- a Starknet-safe unlock payload format
- explicit app-binding tracking for the sender
- fail-closed Sepolia status/verification that explains the real remaining blocker precisely

What it still does not have is a fabricated Starknet deployment or a fake green Sepolia verification result.
