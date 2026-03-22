# Final Project Status

## Implemented Architecture

zkPhil currently consists of four clear layers:

1. L1 identity/proof layer
   - `PhilIdentityGate`
   - `PhilIdentityMint`
   - `FactRegistryHumanityVerifier` / `MockHumanityVerifier`
2. Local Cairo proving layer
   - Cairo + S-two proof generation
   - local prover server
   - fact-registry-oriented public outputs
3. L1 4337/account layer
   - `PhilAccount`
   - `PhilAccountFactory`
   - `PhilPaymaster`
   - `PhilUnlockInbox`
4. Starknet unlock-sender layer
   - `PhilUnlockSender`
   - Starknet app-binding manifest

## What Works Locally Right Now

- local Cairo + S-two proving
- dev-only mock-humanity provider flow
- fact-registry-bridged proof registration
- one-human-one-identity nullifier enforcement
- local 4337/account deployment
- CI-safe local smoke flow via `npm run smoke:local`

Validated in this pass:

- `npm run compile`
- `npx hardhat compile`
- `scarb --manifest-path cairo/Scarb.toml test`
- `npm run starknet:build-unlock-sender`
- targeted bridge/status/account node tests
- `npm run smoke:local`

## What Is Deployed And Tracked On Sepolia

Stable reused L1 art/data:

- `PhilSVGStorage`
- `PhilLayerRegistry`
- `PhilNFT`

Stable reused protocol bindings:

- ERC-4337 `EntryPoint v0.7`
- `StarknetCore`

Tracked mutable L1 identity/proof stack:

- `PhilIdentityGate`
- `PhilIdentityMint`
- `FactRegistryHumanityVerifier`
- supporting renderer/web contracts

Tracked today in:

- [`config/stable-art-backends/sepolia.json`](./config/stable-art-backends/sepolia.json)
- [`config/stable-protocol-bindings/sepolia.json`](./config/stable-protocol-bindings/sepolia.json)
- [`deployments/stark_11155111.json`](./deployments/stark_11155111.json)

## What Is Still Dev-Only

- `HUMANITY_PROVIDER=mock`
- mock-humanity bundle fixtures
- local mock inbox mode on chain `31337`
- the current local unlock/mint smoke flow

## What Is Still Blocked

The remaining public-chain blocker is now precise:

- no real Starknet Sepolia `PhilUnlockSender` deployment is tracked yet
- therefore the Starknet app binding described in [`config/starknet-app-bindings/README.md`](./config/starknet-app-bindings/README.md) is still absent by design
- therefore `deployments/4337_11155111.json` is still absent
- therefore `npm run verify:sepolia` still fails closed honestly

This machine’s direct live blocker in this pass was:

- missing `STARKNET_RPC_URL` / Starknet account credentials for deployment

## Current Trust Boundaries

- The backend is still a request-preparation helper, not a mint-signing authority.
- The identity proof path remains fact-registry based.
- The new Starknet unlock sender is owner-gated and app-specific.
- The 4337 unlock path is still not production-ready multi-factor auth; it is now real and explicit, but still minimal.

## Most Important Remaining Technical Debt

1. The Starknet sender policy is minimal.
   - `PhilUnlockSender` is enough to make the sender path real and testable.
   - It is not yet a full production policy/2FA contract.
2. Local proving remains the slowest developer-loop surface.
3. Cairo tests still rely on deprecated `scarb cairo-test` under the hood.
4. Full Sepolia verification still depends on a live Starknet deployment credential surface that is not yet configured in this workspace.

## Most Important Next-Step Options

1. Provide Starknet Sepolia deploy credentials and run:
   - `npm run starknet:deploy-unlock-sender`
2. Deploy the Sepolia L1 4337/account stack against that sender:
   - `CHAIN_ID=11155111 RPC_URL=<sepolia-rpc> node scripts/deploy_4337.mjs`
3. Bind the Starknet sender to the live `PhilUnlockInbox`:
   - `npm run starknet:set-unlock-recipient`
4. Re-run:
   - `npm run status:sepolia`
   - `npm run verify:sepolia`
5. After that, decide whether to harden `PhilUnlockSender` into a richer Starknet-side policy engine before any production-oriented rollout.
