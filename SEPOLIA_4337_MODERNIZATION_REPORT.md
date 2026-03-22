# SEPOLIA_4337_MODERNIZATION_REPORT

## What was audited

- the current Sepolia ERC-4337/account stack requirements in `scripts/deploy_4337.mjs`
- the mutable-stack manifest reader/writer for `deployments/4337_<chainId>.json`
- `scripts/sepolia/status.mjs`
- `scripts/verify_sepolia_bindings.mjs`
- the current contracts:
  - `PhilAccount`
  - `PhilAccountFactory`
  - `PhilUnlockInbox`
  - `PhilPaymaster`

## What was reused vs mutable

Reused stable Sepolia infrastructure now tracked explicitly:

- `config/stable-art-backends/sepolia.json`
  - `PhilSVGStorage`
  - `PhilLayerRegistry`
  - `PhilNFT`
- `config/stable-protocol-bindings/sepolia.json`
  - `EntryPoint v0.7`: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
  - `StarknetCore`: `0xE2Bb56ee936fd6433DC0F6e7e3b8365C906AA057`

Mutable Sepolia infrastructure:

- `deployments/stark_11155111.json`
  - current and complete for the humanity-ready identity/proof stack
- `deployments/4337_11155111.json`
  - still absent because the app-specific unlock-verifier prerequisite is not yet tracked truthfully

## What manifest/config changes were made

- added `config/stable-protocol-bindings/sepolia.json`
- added `shared/deploy/protocolBindings.mjs`
- made `status:sepolia` report stable protocol bindings separately from stable art/data
- made `status:sepolia` and `verify:sepolia` fall back to tracked stable Sepolia `EntryPoint v0.7` and `StarknetCore`
- tightened 4337 manifest analysis so non-local `useMockInbox=true` and `l2UnlockVerifier=0` are treated as placeholder/public-chain blockers
- tightened `scripts/deploy_4337.mjs` so `MOCK_UNLOCK_INBOX` is live-blocked on non-local chains
- improved live deployment failure messaging so the remaining blocker is explicit
- improved `verify:sepolia` binding resolution so it reports multiple missing values together instead of failing on the first one
- added `PHIL_PAYMASTER.entryPoint()` to live verification coverage

## What was deployed vs reused

Deployed in this pass:

- no live Sepolia 4337/account contracts were deployed

Reused in this pass:

- tracked stable Sepolia `EntryPoint v0.7`
- tracked stable Sepolia `StarknetCore`
- existing tracked Sepolia Stark-side identity/proof stack in `deployments/stark_11155111.json`

## Current Sepolia 4337/account status

Current truthful state:

- stable protocol bindings: complete and verified
- mutable identity/proof stack: complete and verified by status tooling
- mutable 4337/account stack: missing
- overall mutable Sepolia status: partial

`verify:sepolia` does not pass yet.

It now fails for the real remaining reasons:

- `deployments/4337_11155111.json` is still missing
- `PHIL_ACCOUNT_FACTORY` is therefore unresolved
- `PHIL_PAYMASTER` is therefore unresolved
- `L2_UNLOCK_VERIFIER` is still not tracked as a real app-specific Starknet verifier contract

## Whether the full mutable Sepolia stack is now complete

No.

The Stark-side mutable stack is complete.
The ERC-4337/account mutable stack is still incomplete because the unlock-verifier dependency is not yet real/tracked.

## Whether `verify:sepolia` passes honestly

No.

It remains fail-closed, but it now does so with a more legible and accurate Sepolia account-stack story.

## Remaining blockers

- deploy or otherwise truthfully track the Starknet L2 unlock verifier contract/address used by `PhilUnlockInbox`
- once that exists, run `scripts/deploy_4337.mjs` live on Sepolia
- capture the resulting addresses in `deployments/4337_11155111.json`
- rerun `npm run verify:sepolia`
