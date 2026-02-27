# Local E2E Pipeline

`npm run local:e2e` runs a deterministic end-to-end local flow:

1. Starts local Ganache on `127.0.0.1:8545`.
2. Builds deterministic allowlist of 13 wallets.
3. Builds allowlist Merkle root/witnesses.
4. Deploys fragment/palette renderer stack + proof-gated mint contracts.
5. Generates local STARK-dev proof artifacts (no Atlantic/hosted prover).
6. Mints all 13 NFTs with proof gating.
7. Verifies minted parameters and deterministic SVG outputs.
8. Verifies `tokenURI` metadata path and deterministic renderer parameter consistency.

## Commands

```bash
npm run fragments:build
npm run render:verify
npm test
npm run local:e2e
```

For the interactive wallet/frontend journey:

```bash
npm run dev:e2e
```

## Outputs

- `artifacts/local-e2e/report.json`
- `artifacts/local-e2e/allowlist.json`
- `artifacts/local-e2e/svgs/`
- `deployments/local_31337.json`

## Visual validation (54 base combos)

```bash
npm run render:all
```

Output dir:

- `artifacts/rendered-phils/phil-<id>-palette-<variant>.svg`
