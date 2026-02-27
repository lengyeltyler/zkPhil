# Gas and Cost Report

## Commands

Renderer storage/footprint analysis:

```bash
npm run renderer:report
```

Main report (gas + ETH + USD):

```bash
npm run gas:report
```

Outputs:

- `artifacts/renderer-footprint-report.json`
- `gas_report.json`

## Pricing env vars

`npm run gas:report` supports:

- `GAS_GWEI` (default `0.1`)
- `ETH_USD` (default `3000`)
- `RENDER_BUDGET_GAS` (default `12000000`)
- `TOKEN_URI_BUDGET_GAS` (default `2000000`)

Example:

```bash
GAS_GWEI=0.033 ETH_USD=3500 npm run gas:report
```

Custom budget example:

```bash
RENDER_BUDGET_GAS=15000000 TOKEN_URI_BUDGET_GAS=3000000 npm run gas:report
```

## What is measured

- smart account deploy (`LocalSmartAccountFactory.createAccount`)
- proof-verify path gas estimate (`ProofGateTest13.verifyAndConsume` call path)
- mint tx (`PhilTestMint.mint`)
- worst-case renderer tx (`PhilRenderer.renderSvg`)
- `tokenURI` tx (`PhilTestMint.tokenURI`)
- journey totals:
  - smart account deploy + mint
  - smart account deploy + mint + tokenURI

## Notes

- Measurements are on local Ganache execution.
- ETH/USD costs are derived from `GAS_GWEI` and `ETH_USD`.
- Budget gate is enforced on `tokenURI` (main mint metadata path).
- `renderSvg` is reported as a diagnostic in compact mode and may exceed the diagnostic threshold.
