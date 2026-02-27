# Runbook

Date: 2026-02-26

This runbook covers local proof generation, deployment modes, `test13` e2e, and cadence demo.

## 0) Install + compile

```bash
npm ci
npm run compile
```

## 1) Generate a local proof package (Cairo-shaped)

### Basic

```bash
PRIVATE_KEY=0x<recipient_private_key> \
node scripts/proofs/prove_local.mjs \
  --deployment deployments/stark_31337.json \
  --allowlist allowlist.json \
  --out artifacts/proof_package.json
```

### Notes

- `PRIVATE_KEY` must correspond to recipient addresses in `allowlist.json`.
- If `scarb` exists, Cairo is built first.
- If `scarb` is missing, deterministic source-hash fallback is used for `programHash`.

## 2) Deploy in dev mode (local chain + local proof gate)

Start local node:

```bash
npm run node
```

In another terminal:

```bash
PRIVATE_KEY=0x<deployer_private_key> node scripts/deploy_stark.mjs
```

Optional 4337 stack (now proof-gated for account creation):

```bash
PRIVATE_KEY=0x<deployer_private_key> \
PROOF_GATE=0x<ProofGateTest13_address> \
node scripts/deploy_4337.mjs
```

## 3) Deploy in sharp mode (if applicable)

Use the same L1 contract deployment path, then register/verify facts against your SHARP-compatible registry.

1. Deploy contracts (same as dev deployment command above).
2. Generate proof package with `scripts/proofs/prove_local.mjs`.
3. Submit proofs/facts through your SHARP operator process.
4. Verify registration:

```bash
RPC_URL=https://<network-rpc> \
FACT_REGISTRY=0x<sharp_fact_registry> \
node scripts/proofs/verify_fact_registered.mjs \
  --package artifacts/proof_package.json
```

Manual SHARP workflow details: `docs/proofs/SHARP_SUBMISSION.md`.

## 4) Run test13 e2e

```bash
PRIVATE_KEY=0x<allowlist_recipient_private_key> \
DEPLOYER_PRIVATE_KEY=0x<deployer_private_key> \
node scripts/test13_e2e.mjs
```

If `PRIVATE_KEY` does not match the allowlist recipient, minting fails at proof-signature verification.

## 5) Run cadence demo

Start local node:

```bash
npm run node
```

In another terminal:

```bash
node scripts/cadence_demo.mjs
```

The demo:

- deploys `ProofGateTest13` + `Phil369CadenceMint`
- authorizes cadence contract in proof gate
- assigns `windowMinter`
- mints once
- advances time by 36h + 1s
- assigns `windowMinter` again
- mints second time
- prints final state

## 6) Run targeted tests

```bash
node --test test/allowlist-proof.contract.test.mjs
node --test test/account.smoke.test.mjs
node --test test/marketplace.smoke.test.mjs
node --test test/proof-parity.action.test.mjs
node --test test/cadence.test.mjs
```
