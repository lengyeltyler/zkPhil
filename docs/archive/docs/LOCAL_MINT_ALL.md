# Local Mint-All (13/13) E2E

This flow is local-only and requires:

- chainId `31337`
- RPC `http://127.0.0.1:8545`

## Run

From repo root:

```bash
bash scripts/run_local_e2e.sh down
bash scripts/run_local_e2e.sh up
npm run local:mint-all
```

## What `local:mint-all` does

1. Loads local deployment artifacts:
   - `deployments/stark_31337.json`
   - `deployments/4337_31337.json`
2. Uses the full on-chain renderer stack locally (`PhilFragments` + `PhilPalettes` + `PhilRenderer` + `PhilWeb3`), not `MockRenderer`.
3. Uses Hardhat EOAs `0..12` to mint all 13 tokens via ERC-4337 `handleOps`.
4. For each mint:
   - computes deterministic `starkPubKeyX`
   - computes Smart Account using `PhilAccountFactory.getPhilAddress`
   - uses `initCode` path (requires undeployed account before mint)
   - optionally runs `simulateValidation` (set `SIMULATE_VALIDATION=0` to disable)
   - verifies:
     - `totalSupply == i+1`
     - `ownerOf(tokenId) == smartAccount`
     - `decalId` is marked used
     - `tokenURI` resolves to SVG content (via compact `web3://` mode)
     - SVG is not the placeholder circle and passes structure/size checks
5. Enforces on-chain frame/lens pairing in renderer:
   - `outlineId` `{0,2}` => `Frame1 + LensShapes1`
   - `outlineId` `{1,3}` => `Frame2 + LensShapes2`
6. Writes decoded SVG files to:
   - `artifacts/local_mint_svgs/token_<id>.svg`
7. Writes report to:
   - `artifacts/local_mint_report.json`
8. Attempts mint #14 and asserts it reverts once supply is maxed out.

## Optional flags

Disable simulation pass:

```bash
SIMULATE_VALIDATION=0 npm run local:mint-all
```
