# CLEANUP_REPORT

## What was cleaned up

- added `npm run smoke:local` as the single CI-safe local smoke command
- added `npm run status:sepolia` as the single readable Sepolia status/verification view
- kept `npm run verify:sepolia` as the stricter live-verification alias
- made the local smoke path write a machine-readable summary to `.local-dev/smoke-local-summary.json`
- tightened `.env.example`, `README.md`, and `DEV_RUNBOOK.md` around the current provider-aware workflow

## Leftovers removed

Removed from the active tracked workflow:

- `HUMANITY_BUNDLE_PATH`
- `CONTEXT_ID`
- `ELIGIBILITY_BUNDLE_PATH`
- `ELIGIBILITY_ROOT`

These were legacy compatibility aliases from earlier refactors and made the current config surface harder to reason about.

## Aliases and compatibility shims that remain

- `verify:sepolia`
  - kept as a compatibility alias because existing scripts and habits already refer to it
  - now maps to the stricter live Sepolia verification path

- `PAYMASTER_SIGNER`
  - kept as an address-only override so Sepolia status/verification can run without exposing a private key when read-only verification is sufficient

- database migration from `allowlist_entitlements` to `eligibility_entitlements`
  - kept because existing local DBs may still carry the old table name

## Small technical debt fixed

- local smoke orchestration now lives in one Node script instead of a loose sequence of commands
- smoke execution now has deterministic on-chain assertions and structured summary output
- Sepolia status can now report reused stable art/data contracts separately from mutable identity/account manifests
- the Sepolia verifier script now uses the shared RPC retry helper instead of a duplicate retry loop
- stale comments and wording around old phases / compatibility fields were updated where touched

## Still left alone

- the broader older/untracked workspace artifacts were not touched because they are outside the tracked cleanup scope
- the deprecated Scarb Cairo test path was left alone for now because migrating to `snforge` cleanly would be a larger workflow change than this pass allows
- Ganache `µWS` fallback behavior was not changed because it is noisy but not currently breaking the validated workflow
