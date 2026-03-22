# Starknet App Bindings

`sepolia.json` is intentionally created only after a real Starknet-side `PhilUnlockSender` deployment.

That manifest tracks the app-specific Starknet unlock sender separately from:

- reused protocol bindings in [`../stable-protocol-bindings/sepolia.json`](../stable-protocol-bindings/sepolia.json)
- mutable L1 Stark/identity state in [`../../deployments/stark_11155111.json`](../../deployments/stark_11155111.json)
- mutable L1 4337/account state in [`../../deployments/4337_11155111.json`](../../deployments/4337_11155111.json)

The manifest is expected to record:

- Starknet `unlockSender`
- Starknet `owner`
- bound L1 `PhilUnlockInbox` recipient
- the current unlock payload format (`zkphil-unlock-ticket-v1`)
- the current constraints-hash encoding (`bytes32-hi-lo-128`)

If the file is absent, `status:sepolia`, `verify:sepolia`, and `deploy_4337.mjs` now treat that as a real missing dependency, not as an implicit env-only fallback.
