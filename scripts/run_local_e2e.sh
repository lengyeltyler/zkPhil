#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.local-dev"
mkdir -p "$STATE_DIR"

DEFAULT_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
RPC_URL="http://127.0.0.1:8545"
SERVER_URL="http://127.0.0.1:8787"
PROVER_URL="http://127.0.0.1:8747"
MOCK_BUNDLE_PATH="$ROOT_DIR/artifacts/proofs/mock-humanity-bundle.json"
DATABASE_PATH="$ROOT_DIR/server-ts/data/mock-humanity.local.db"

wait_for_rpc() {
  local attempts=0
  until curl -s -X POST "$RPC_URL" \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1
  do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 60 ]]; then
      echo "Timed out waiting for local chain at $RPC_URL" >&2
      exit 1
    fi
    sleep 1
  done
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts=0
  until curl -s "$url" >/dev/null 2>&1
  do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 60 ]]; then
      echo "Timed out waiting for $label at $url" >&2
      exit 1
    fi
    sleep 1
  done
}

stop_pidfile() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$pidfile"
  fi
}

start_up() {
  "$0" down >/dev/null 2>&1 || true

  echo "Starting local Hardhat node..."
  (
    cd "$ROOT_DIR"
    nohup npx hardhat node >"$STATE_DIR/hardhat.log" 2>&1 &
    echo $! >"$STATE_DIR/hardhat.pid"
  )
  wait_for_rpc

  echo "Building mock-humanity bundle..."
  (
    cd "$ROOT_DIR"
    node scripts/proofs/build_mock_humanity_bundle.mjs \
      --in fixtures/mock_humans.dev.json \
      --out "$MOCK_BUNDLE_PATH" \
      --proofContext 13 \
      >"$STATE_DIR/mock-humanity-bundle.log" 2>&1
  )

  echo "Compiling contracts..."
  (
    cd "$ROOT_DIR"
    npm run compile >"$STATE_DIR/manual-compile.log" 2>&1
    npx hardhat compile >"$STATE_DIR/hardhat-compile.log" 2>&1
  )

  echo "Deploying Phil identity stack in mock-humanity mode..."
  (
    cd "$ROOT_DIR"
    export CHAIN_ID=31337
    export RPC_URL="$RPC_URL"
    export PRIVATE_KEY="$DEFAULT_PRIVATE_KEY"
    export PROGRAM_HASH="0x4444444444444444444444444444444444444444444444444444444444444444"
    export PROOF_CONTEXT=13
    export HUMANITY_PROVIDER=mock
    export MOCK_HUMANITY_BUNDLE_PATH="$MOCK_BUNDLE_PATH"
    export FACT_REGISTRY_OPERATOR_KEY="$DEFAULT_PRIVATE_KEY"
    export MOCK_UNLOCK_INBOX=true
    export PAYMASTER_DEPOSIT=0.001
    node scripts/deploy_stark.mjs >"$STATE_DIR/deploy-stark.log" 2>&1
    node scripts/deploy_4337.mjs >"$STATE_DIR/deploy-4337.log" 2>&1
  )

  echo "Starting local prover..."
  (
    cd "$ROOT_DIR"
    nohup env \
      LOCAL_PROVER_HOST=127.0.0.1 \
      LOCAL_PROVER_PORT=8747 \
      LOCAL_PROVER_MANIFEST=./cairo/Scarb.toml \
      LOCAL_PROVER_ENABLE_PROVE=true \
      LOCAL_PROVER_ENABLE_VERIFY=false \
      node scripts/proofs/local_prover_server.mjs \
      >"$STATE_DIR/local-prover.log" 2>&1 &
    echo $! >"$STATE_DIR/local-prover.pid"
  )
  wait_for_http "$PROVER_URL/health" "local prover"

  echo "Starting backend..."
  (
    cd "$ROOT_DIR/server-ts"
    nohup env \
      NODE_ENV=development \
      HOST=127.0.0.1 \
      PORT=8787 \
      CHAIN_ID=31337 \
      RPC_URL="$RPC_URL" \
      PRIVATE_KEY="$DEFAULT_PRIVATE_KEY" \
      PAYMASTER_SIGNER_KEY="$DEFAULT_PRIVATE_KEY" \
      FACT_REGISTRY_OPERATOR_KEY="$DEFAULT_PRIVATE_KEY" \
      PROGRAM_HASH="0x4444444444444444444444444444444444444444444444444444444444444444" \
      PROOF_CONTEXT=13 \
      HUMANITY_PROVIDER=mock \
      MOCK_HUMANITY_BUNDLE_PATH="$MOCK_BUNDLE_PATH" \
      DATABASE_PATH="$DATABASE_PATH" \
      ALLOW_LOOPBACK_ORIGINS=true \
      CORS_ORIGINS="http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173" \
      npx tsx src/index.ts \
      >"$STATE_DIR/backend.log" 2>&1 &
    echo $! >"$STATE_DIR/backend.pid"
  )
  wait_for_http "$SERVER_URL/health" "backend"

  echo
  echo "Local mock-humanity stack is ready."
  echo "  Chain:   $RPC_URL"
  echo "  Server:  $SERVER_URL/status"
  echo "  Prover:  $PROVER_URL/health"
  echo "  Bundle:  $MOCK_BUNDLE_PATH"
}

stop_down() {
  stop_pidfile "$STATE_DIR/backend.pid"
  stop_pidfile "$STATE_DIR/local-prover.pid"
  stop_pidfile "$STATE_DIR/hardhat.pid"
}

show_status() {
  echo "Hardhat PID: $(cat "$STATE_DIR/hardhat.pid" 2>/dev/null || echo stopped)"
  echo "Backend PID: $(cat "$STATE_DIR/backend.pid" 2>/dev/null || echo stopped)"
  echo "Prover PID:  $(cat "$STATE_DIR/local-prover.pid" 2>/dev/null || echo stopped)"
}

case "${1:-}" in
  up)
    start_up
    ;;
  down)
    stop_down
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {up|down|status}" >&2
    exit 1
    ;;
esac
