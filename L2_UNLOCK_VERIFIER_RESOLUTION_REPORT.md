# L2 Unlock Verifier Resolution

## Previous assumption

`L2_UNLOCK_VERIFIER` was previously treated across the Sepolia 4337 tooling as if it were some kind of reusable verifier binding. That naming was inaccurate for the current zkPhil architecture.

## Actual architectural answer

In the current humanity-ready design, the value is still required, but it is not an L1 verifier contract.

It is the Starknet L2 sender contract felt that `PhilUnlockInbox` passes into `StarknetCore.consumeMessageFromL2(...)` when consuming unlock-ticket messages on L1.

That means:

- the canonical meaning is now `L2_UNLOCK_SENDER`
- `L2_UNLOCK_VERIFIER` is retained only as a compatibility alias
- the value is app-specific, not a stable reusable protocol binding
- it does not belong in `config/stable-protocol-bindings/sepolia.json` as a deployable reusable contract
- it must come from the app-side Starknet unlock-ticket deployment story before live Sepolia 4337 deployment can complete honestly

## Codepaths touched

Canonicalized around `L2_UNLOCK_SENDER` while keeping compatibility:

- `contracts/PhilUnlockInbox.sol`
- `scripts/deploy_4337.mjs`
- `scripts/verify_sepolia_bindings.mjs`
- `scripts/sepolia/status.mjs`
- `shared/deploy/mutableStackManifest.mjs`
- `.env.example`
- `README.md`
- `DEV_RUNBOOK.md`
- `docs/ARCHITECTURE.md`
- `MIGRATION_NOTES.md`
- targeted status/manifest/verification tests

## Removed vs retained

Removed:

- the misleading idea that this binding is a stable Sepolia protocol-level verifier input
- verifier-style wording in the active 4337 deploy/status/verify path

Retained intentionally:

- env compatibility alias `L2_UNLOCK_VERIFIER`
- manifest compatibility alias `l2UnlockVerifier`
- `PhilUnlockInbox.l2VerifierAddress()` compatibility getter for older tooling

Those retained aliases now point to the same canonical `l2UnlockSender` meaning and are explicitly documented as compatibility-only.

## Deployment result

Real Sepolia 4337/account deployment was not completed in this pass.

The deploy preflight now fails with a precise architectural error:

- the stable reusable bindings (`EntryPoint v0.7`, `StarknetCore`) are present and verified
- the Stark-side mutable identity/proof stack is present and verified
- the missing blocker is still the app-specific Starknet L2 unlock sender felt

No fake `deployments/4337_11155111.json` was created.

## Verification result

`npm run verify:sepolia` still does not pass honestly.

It now fails/skips for the correct reasons:

- `deployments/4337_11155111.json` is still missing
- `PHIL_ACCOUNT_FACTORY` is unresolved
- `PHIL_PAYMASTER` is unresolved
- `L2_UNLOCK_SENDER` is unresolved

## Remaining blockers

To complete the Sepolia 4337/account layer honestly, zkPhil still needs:

- a real app-side Starknet unlock-ticket sender contract or tracked sender address/felt
- that sender value tracked as `L2_UNLOCK_SENDER`
- a real Sepolia 4337 deployment recorded in `deployments/4337_11155111.json`

Until then, the correct repo state is:

- local 4337 flow works in dev/test with mock inbox mode
- Sepolia Stark-side identity/proof is modern and tracked
- Sepolia reusable protocol bindings are modern and tracked
- Sepolia 4337 remains intentionally blocked by the missing app-specific Starknet unlock sender
