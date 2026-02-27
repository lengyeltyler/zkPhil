# philCodex Local Test Structures

This repository is now **local-only**.

- Chain ID: `31337`
- RPC: `http://127.0.0.1:8545`
- Frontend deployment files:
  - `deployments/stark_31337.json`
  - `deployments/4337_31337.json`
- Backend deployment files:
  - `deployments/stark_31337.json`
  - `deployments/4337_31337.json`

If any service is on a different chain, startup/connect is blocked.

## 1) Quick start (single command)

```bash
cd /Users/tylerlengyel/philCodex
npm install
npm --prefix server-ts install
bash scripts/dev.sh
```

This starts:
1. Hardhat node
2. Local proof generation
3. Local STARK + 4337 deployments
4. Backend server on `http://127.0.0.1:8787`
5. Frontend static server on `http://localhost:8080`

Open:
- `http://localhost:8080/frontend/mint.html`

Stop everything with `Ctrl+C` in the `dev.sh` terminal.

## 2) Manual start (4 terminals)

### Terminal A: Hardhat

```bash
cd /Users/tylerlengyel/philCodex
npm run node
```

### Terminal B: Deploy local contracts

```bash
cd /Users/tylerlengyel/philCodex

export DROP_ID=1
export PROGRAM_HASH=0x1111111111111111111111111111111111111111111111111111111111111111
export ADMIN_KEY=local-admin-key
export PAYMASTER_SIGNER_KEY=0x59c6995e998f97a5a0044966f0945387dc9ea3b1a93f2d2d3d3f3f4f5f6f7f8f

cd server-ts
FAKE_PROOFS=true \
ALLOWLIST_PATH=../allowlist.json \
PROGRAM_HASH=$PROGRAM_HASH \
DROP_ID=$DROP_ID \
DATABASE_PATH=./data/phil_test13.db \
npm run generate:proofs
cd ..

export MERKLE_ROOT=$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('server-ts/allowlist_proofs.json','utf8'));console.log(p.merkleRoot)")

MOCK_SATELLITE=true SKIP_FRAGMENT_BUILD=true node scripts/deploy_stark.mjs
MOCK_UNLOCK_INBOX=true PAYMASTER_SIGNER_KEY=$PAYMASTER_SIGNER_KEY node scripts/deploy_4337.mjs
```

### Terminal C: Backend

```bash
cd /Users/tylerlengyel/philCodex/server-ts

export DROP_ID=1
export PROGRAM_HASH=0x1111111111111111111111111111111111111111111111111111111111111111
export MERKLE_ROOT=$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('./allowlist_proofs.json','utf8'));console.log(p.merkleRoot)")
export ADMIN_KEY=local-admin-key
export DATABASE_PATH=./data/phil_test13.db
export PAYMASTER_SIGNER_KEY=0x59c6995e998f97a5a0044966f0945387dc9ea3b1a93f2d2d3d3f3f4f5f6f7f8f
export ALLOW_LOOPBACK_ORIGINS=true

npm run dev
```

### Terminal D: Frontend

```bash
cd /Users/tylerlengyel/philCodex
npx serve . -l 8080
```

Open:
- `http://localhost:8080/frontend/mint.html`

## 3) Verification commands

Run from repo root:

```bash
npm run compile
npm test
npm --prefix server-ts test
npm --prefix server-ts run build
npm run local:check-account
npm run local:check-initcode
npm run local:simulate-userop
```

Expected:
- Local chain checks pass
- Account derivation parity passes
- initCode sender check passes
- simulateValidation + handleOps path passes

## 4) Green path checklist (manual)

1. In MetaMask, switch to local network `31337` (`http://127.0.0.1:8545`).
2. Import a funded Hardhat key.
3. Open mint page and click `Connect Wallet`.
4. Confirm config banner shows local chain and local deployment files.
5. Scroll until selection locks and `Mint` appears.
6. Click `Mint`.
7. Confirm success state and updated supply.
8. Verify minted owner is Smart Account and `tokenURI` returns SVG data.

## 5) Local helpers

```bash
bash scripts/run_local_e2e.sh up
bash scripts/run_local_e2e.sh status
bash scripts/run_local_e2e.sh down
```

