# SHARP Submission (Manual)

This repository uses local proof generation (`scripts/proofs/prove_local.mjs`) plus on-chain fact checks through an `isValid(bytes32)` registry interface.

When fully managed SHARP submission is unavailable, use this manual sequence.

## 1) Generate local proof package

```bash
node scripts/proofs/prove_local.mjs \
  --deployment deployments/stark_31337.json \
  --allowlist allowlist.json \
  --out artifacts/proof_package.json
```

## 2) Build Cairo program artifact (if `scarb` exists)

```bash
cd cairo
scarb build
cd ..
```

`prove_local.mjs` already attempts this build and records whether it used `scarb` or deterministic source-hash fallback.

## 3) Submit proof/fact to SHARP operator flow

- Use your SHARP operator tooling to submit the Cairo program + public inputs.
- Wait for resulting fact registration in the target registry contract.
- Record returned fact hash(es).

## 4) Verify fact registration on-chain

Single fact:

```bash
node scripts/proofs/verify_fact_registered.mjs \
  --rpc "$RPC_URL" \
  --registry "$FACT_REGISTRY" \
  --fact 0x<fact_hash>
```

Entire package:

```bash
node scripts/proofs/verify_fact_registered.mjs \
  --rpc "$RPC_URL" \
  --registry "$FACT_REGISTRY" \
  --package artifacts/proof_package.json
```

Expected output lines are `FOUND 0x...`. Any `MISSING 0x...` returns non-zero exit code.

## Notes

- `contracts/proofs/DevProofVerifier.sol` is DEV-only and reverts outside local chainId `31337`.
- Production deployments must point to a real SHARP-compatible fact registry.
