# Frontend Local E2E (Sticky Bar Flow)

This covers the full local user journey:

1. Browse deterministic feed without wallet.
2. Connect wallet.
3. Verify allowlist ownership via signature challenge.
4. Mint selected combo with local STARK-dev proof artifact.
5. Mint to deterministic smart account.
6. Verify `tokenURI` output and compact image path deterministically against selected params.

## Local stack

- Chain: Ganache `31337`
- RPC: `http://127.0.0.1:8545`
- Frontend: `http://127.0.0.1:5173`
- Frontend API: `http://127.0.0.1:8787`

## One-command startup

```bash
npm install
npm run dev:e2e
```

`npm run dev:e2e` will:

- start Ganache (if needed)
- compile + deploy contracts
- start frontend API
- start Vite frontend
- print deterministic allowlisted dev wallets/private keys (**LOCAL ONLY**)

Artifacts:

- `deployments/local_31337.json`
- `artifacts/local-frontend/allowlist.json`
- `artifacts/local-frontend/dev-wallets.json`

## Recommended dev wallet (local only)

- Address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Private key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`

## Exact click flow

1. Open `http://127.0.0.1:5173`.
2. Scroll feed cards and click `Select` on desired combo.
3. In sticky top bar: click `Connect`.
4. If needed: click `Switch 31337`.
5. Click `Verify Allowlist`.
6. Click `Mint`.
7. Confirm token id + tx hash appear in sticky status.
8. Click `Verify On-Chain`.
9. Confirm:
   - `Params Match: yes`
   - `SVG Match: yes`
   - decoded SVG preview renders

## Programmatic smoke check

With `npm run dev:e2e` running:

```bash
npm run frontend:smoke
```

Expected output: `frontend-flow-smoke: OK`.

## Stop services

Press `Ctrl+C` in the terminal running `npm run dev:e2e`.
