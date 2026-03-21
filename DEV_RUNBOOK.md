# DEV_RUNBOOK

## Goal

Run zkPhil locally in `HUMANITY_PROVIDER=mock` mode and exercise:

- local Cairo + S-two proving
- fact-registry bridge registration
- Phil identity minting
- one-human-one-identity enforcement
- smart-account create + mint flow

This flow is DEV/TEST ONLY.
It is not World ID.

## Prereqs

```bash
npm install
cd server-ts && npm install && cd ..
```

## Option A: single-command smoke

Run the full local smoke pass:

```bash
npm run smoke:local
```

This command:

- brings the local stack up fresh
- checks readiness
- runs the mock-humanity flow
- asserts token ownership and supply changes
- writes `.local-dev/smoke-local-summary.json`
- tears the stack down

## Option B: helper bootstrap

Bring up the local stack:

```bash
npm run local:up -- --fresh
```

Check readiness:

```bash
npm run local:status
```

Serve the frontend:

```bash
npx serve . -l 8080
```

Open:

```text
http://localhost:8080/frontend/mint.html?chainId=31337&server=http://127.0.0.1:8787&localProver=http://127.0.0.1:8747
```

Run the CLI smoke flow:

```bash
npm run local:mock-flow
```

Stop helper-managed services:

```bash
npm run local:down
```

Notes:

- The helper auto-selects a Node 22 runtime when the interactive shell is pinned to an older Node.
- Stable proof bundles are written to `generated/proofs/`, not `artifacts/`, so Solidity compile steps do not erase them.
- Helper logs live under `.local-dev/`.

## Option C: explicit manual bootstrap

### 1. Build the mock-humanity bundle

```bash
node scripts/proofs/build_mock_humanity_bundle.mjs \
  --in fixtures/mock_humans.dev.json \
  --out generated/proofs/mock-humanity-bundle.json \
  --proofContext 13
```

Before running manual commands, make sure `node -v` is `v22.x` or set `NODE_BIN` to a Node 22 binary.

### 2. Start the local chain

```bash
npx hardhat node
```

### 3. Compile contracts

In a second terminal:

```bash
npm run compile
npx hardhat compile
```

### 4. Deploy the identity stack in mock-humanity mode

```bash
export CHAIN_ID=31337
export RPC_URL=http://127.0.0.1:8545
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export PROGRAM_HASH=0x4444444444444444444444444444444444444444444444444444444444444444
export PROOF_CONTEXT=13
export HUMANITY_PROVIDER=mock
export MOCK_HUMANITY_BUNDLE_PATH=./generated/proofs/mock-humanity-bundle.json
export FACT_REGISTRY_OPERATOR_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export ART_BACKEND_MODE=deploy-local
export ART_BACKEND_MANIFEST_PATH=./deployments/art_31337.json
node scripts/deploy_stark.mjs
```

### 5. Deploy the 4337 stack

```bash
export MOCK_UNLOCK_INBOX=true
export PAYMASTER_DEPOSIT=0.001
node scripts/deploy_4337.mjs
```

### 6. Start the local prover

In a third terminal:

```bash
export LOCAL_PROVER_HOST=127.0.0.1
export LOCAL_PROVER_PORT=8747
export LOCAL_PROVER_MANIFEST=./cairo/Scarb.toml
export LOCAL_PROVER_ENABLE_PROVE=true
export LOCAL_PROVER_ENABLE_VERIFY=false
node scripts/proofs/local_prover_server.mjs
```

### 7. Start the backend

In a fourth terminal:

```bash
cd server-ts
export NODE_ENV=development
export HOST=127.0.0.1
export PORT=8787
export CHAIN_ID=31337
export RPC_URL=http://127.0.0.1:8545
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export PAYMASTER_SIGNER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export FACT_REGISTRY_OPERATOR_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export PROGRAM_HASH=0x4444444444444444444444444444444444444444444444444444444444444444
export PROOF_CONTEXT=13
export HUMANITY_PROVIDER=mock
export MOCK_HUMANITY_BUNDLE_PATH=../generated/proofs/mock-humanity-bundle.json
export DATABASE_PATH=../server-ts/data/mock-humanity.local.db
export ALLOW_LOOPBACK_ORIGINS=true
npx tsx src/index.ts
```

### 8. Start the frontend

In a fifth terminal:

```bash
npx serve . -l 8080
```

### 9. Exercise the frontend flow

Open:

```text
http://localhost:8080/frontend/mint.html?chainId=31337&server=http://127.0.0.1:8787&localProver=http://127.0.0.1:8747
```

Then:

1. Connect a funded local wallet from the Hardhat mnemonic.
2. Keep the page on local chain `31337`.
3. Choose a mock human such as `atlas`.
4. Select a Phil.
5. Mint.
6. Try `atlas` again and confirm the flow is rejected.
7. Switch to `briar` and confirm it can mint.

### 10. Run the direct CLI mock-humanity flow

```bash
npm run local:mock-flow
```

This script:

- authenticates two local wallets
- requests account-create and mint proofs in mock-humanity mode
- proves locally
- registers facts
- creates smart accounts
- mints once for mock human A
- confirms the same mock human cannot mint twice
- mints once for mock human B

## Relevant test commands

### Local smoke

```bash
npm run smoke:local
```

### Cairo

```bash
scarb --manifest-path cairo/Scarb.toml test
```

### Server

```bash
cd server-ts && npx vitest --run \
  src/lib/eligibility.test.ts \
  src/routes/status.test.ts \
  src/routes/requestMint.test.ts \
  src/routes/requestMint.production.test.ts \
  src/routes/signPaymaster.test.ts
```

### Contract / integration surfaces

```bash
node --test \
  test/eligibility-proof.contract.test.mjs \
  test/mock-humanity.contract.test.mjs \
  test/error-cases.contract.test.mjs \
  test/verify-sepolia-bindings.test.mjs \
  test/sepolia-status.test.mjs
```

## Reuse notes

- Stable Sepolia trait/data addresses are tracked in `config/stable-art-backends/sepolia.json`.
- Local helper runs write mutable manifests under `deployments/art_31337.json`, `deployments/stark_31337.json`, and `deployments/4337_31337.json`.
- `ART_BACKEND_MODE=reuse-existing-data` reuses a healthy local art manifest.
- `ART_BACKEND_MODE=reuse-stable` is intended for stable public-chain trait/data reuse.

## Sepolia status

Use:

```bash
npm run status:sepolia
```

For strict live verification with a usable Sepolia RPC and signer config:

```bash
npm run verify:sepolia
```
