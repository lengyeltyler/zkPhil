#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.local-dev"
mkdir -p "$STATE_DIR"

DEFAULT_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
SERVER_URL="${SERVER_URL:-http://127.0.0.1:8787}"
PROVER_URL="${PROVER_URL:-http://127.0.0.1:8747}"
MOCK_BUNDLE_PATH="$ROOT_DIR/generated/proofs/mock-humanity-bundle.json"
DATABASE_PATH="$ROOT_DIR/server-ts/data/mock-humanity.local.db"
ART_MANIFEST_PATH="${ART_BACKEND_MANIFEST_PATH:-$ROOT_DIR/deployments/art_31337.json}"
STARK_MANIFEST_PATH="$ROOT_DIR/deployments/stark_31337.json"
AA_MANIFEST_PATH="$ROOT_DIR/deployments/4337_31337.json"
HARDHAT_BIN="$ROOT_DIR/node_modules/.bin/hardhat"
TSX_BIN="$ROOT_DIR/server-ts/node_modules/.bin/tsx"

version_major() {
  local version="${1#v}"
  echo "${version%%.*}"
}

resolve_node_bin() {
  if [[ -n "${NODE_BIN:-}" ]]; then
    echo "$NODE_BIN"
    return
  fi

  local current_node=""
  local current_version=""
  if current_node="$(command -v node 2>/dev/null)"; then
    current_version="$("$current_node" -p 'process.version' 2>/dev/null || true)"
    if [[ -n "$current_version" ]] && [[ "$(version_major "$current_version")" -ge 22 ]]; then
      echo "$current_node"
      return
    fi
  fi

  local nvm_root="$HOME/.nvm/versions/node"
  if [[ -d "$nvm_root" ]]; then
    local candidate=""
    while IFS= read -r path; do
      local candidate_version
      candidate_version="$("$path" -p 'process.version' 2>/dev/null || true)"
      if [[ -n "$candidate_version" ]] && [[ "$(version_major "$candidate_version")" -ge 22 ]]; then
        candidate="$path"
      fi
    done < <(find "$nvm_root" -type f -path '*/bin/node' | sort -V)

    if [[ -n "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  fi

  if [[ -n "$current_node" ]]; then
    echo "$current_node"
    return
  fi

  echo ""
}

NODE_BIN="$(resolve_node_bin)"
if [[ -n "$NODE_BIN" ]]; then
  NODE_VERSION="$("$NODE_BIN" -p 'process.version' 2>/dev/null || echo 'unknown')"
else
  NODE_VERSION="missing"
fi

status_field() {
  "$NODE_BIN" "$ROOT_DIR/scripts/local/stack_status.mjs" \
    --chainId 31337 \
    --rpc "$RPC_URL" \
    --server "$SERVER_URL" \
    --prover "$PROVER_URL" \
    --artManifest "$ART_MANIFEST_PATH" \
    --field "$1"
}

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
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

show_log_tail() {
  local logfile="$1"
  if [[ -f "$logfile" ]]; then
    echo
    echo "Last lines from $logfile:"
    tail -n 80 "$logfile" || true
  fi
}

fail_with_log() {
  local message="$1"
  local logfile="${2:-}"
  echo "ERROR: $message" >&2
  if [[ -n "$logfile" ]]; then
    show_log_tail "$logfile" >&2
  fi
  exit 1
}

require_executable() {
  local file="$1"
  local label="$2"
  if [[ ! -x "$file" ]]; then
    fail_with_log "$label is missing or not executable at $file"
  fi
}

require_node_runtime() {
  if [[ -z "$NODE_BIN" ]]; then
    fail_with_log "Node.js 22+ is required, but no node binary was found."
  fi

  local major
  major="$(version_major "$NODE_VERSION")"
  if [[ -z "$major" ]] || [[ "$major" -lt 22 ]]; then
    fail_with_log \
      "zkPhil local dev requires Node.js 22+. Resolved $NODE_BIN ($NODE_VERSION). Set NODE_BIN to a Node 22 binary if needed."
  fi
}

wait_for_rpc() {
  local attempts=0
  until [[ "$(status_field rpc.healthy)" == "true" ]]
  do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 60 ]]; then
      fail_with_log "Timed out waiting for local chain at $RPC_URL" "$STATE_DIR/hardhat.log"
    fi
    sleep 1
  done
}

wait_for_rpc_down() {
  local attempts=0
  until [[ "$(status_field rpc.healthy)" != "true" ]]
  do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 5 ]]; then
      return 1
    fi
    sleep 1
  done
  return 0
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local field="$3"
  local logfile="${4:-}"
  local attempts=0
  until [[ "$(status_field "$field")" == "true" ]]
  do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 60 ]]; then
      fail_with_log "Timed out waiting for $label at $url" "$logfile"
    fi
    sleep 1
  done
}

run_logged() {
  local label="$1"
  local logfile="$2"
  shift 2
  echo "$label..."
  if ! "$@" >"$logfile" 2>&1; then
    fail_with_log "$label failed." "$logfile"
  fi
}

start_hardhat() {
  local fresh="${1:-false}"
  if [[ "$(status_field rpc.healthy)" == "true" ]]; then
    if [[ "$fresh" == "true" ]]; then
      echo "Resetting existing local Hardhat chain state..."
      if ! curl -s -X POST "$RPC_URL" \
        -H 'content-type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"hardhat_reset","params":[]}' \
        >/dev/null 2>&1; then
        fail_with_log "Fresh mode found a live RPC at $RPC_URL but could not hardhat_reset it."
      fi
      wait_for_rpc
      echo "Local Hardhat node reset and ready at $RPC_URL"
      return
    fi

    echo "Local Hardhat node already healthy. Reusing $RPC_URL"
    return
  fi

  if port_in_use 8545; then
    fail_with_log "Port 8545 is already in use, but no compatible local chain responded at $RPC_URL."
  fi

  stop_pidfile "$STATE_DIR/hardhat.pid"
  require_executable "$HARDHAT_BIN" "Hardhat CLI"
  echo "Starting local Hardhat node..."
  (
    cd "$ROOT_DIR"
    nohup "$NODE_BIN" "$HARDHAT_BIN" node >"$STATE_DIR/hardhat.log" 2>&1 &
    echo $! >"$STATE_DIR/hardhat.pid"
  )
  wait_for_rpc
}

build_bundle() {
  run_logged \
    "Building mock-humanity bundle" \
    "$STATE_DIR/mock-humanity-bundle.log" \
    bash -lc "cd '$ROOT_DIR' && '$NODE_BIN' scripts/proofs/build_mock_humanity_bundle.mjs --in fixtures/mock_humans.dev.json --out '$MOCK_BUNDLE_PATH' --proofContext 13"
}

compile_local_contracts() {
  run_logged \
    "Compiling manual Solidity artifacts" \
    "$STATE_DIR/manual-compile.log" \
    bash -lc "cd '$ROOT_DIR' && '$NODE_BIN' scripts/local/compileContracts.mjs"
  run_logged \
    "Compiling Hardhat artifacts" \
    "$STATE_DIR/hardhat-compile.log" \
    bash -lc "cd '$ROOT_DIR' && '$NODE_BIN' '$HARDHAT_BIN' compile"
}

deploy_stark_if_needed() {
  if [[ "$(status_field starkCore.ready)" == "true" ]]; then
    echo "Phil identity core already healthy. Reusing $STARK_MANIFEST_PATH"
    return
  fi

  local art_mode="reuse-existing-data"
  if [[ "$(status_field artBackend.ready)" != "true" ]]; then
    art_mode="deploy-local"
  fi

  echo "Deploying Phil identity core (ART_BACKEND_MODE=$art_mode)..."
  if ! (
    cd "$ROOT_DIR"
    export CHAIN_ID=31337
    export RPC_URL="$RPC_URL"
    export PRIVATE_KEY="$DEFAULT_PRIVATE_KEY"
    export PROGRAM_HASH="0x4444444444444444444444444444444444444444444444444444444444444444"
    export PROOF_CONTEXT=13
    export HUMANITY_PROVIDER=mock
    export MOCK_HUMANITY_BUNDLE_PATH="$MOCK_BUNDLE_PATH"
    export FACT_REGISTRY_OPERATOR_KEY="$DEFAULT_PRIVATE_KEY"
    export ART_BACKEND_MODE="$art_mode"
    export ART_BACKEND_MANIFEST_PATH="$ART_MANIFEST_PATH"
    "$NODE_BIN" scripts/deploy_stark.mjs
  ) >"$STATE_DIR/deploy-stark.log" 2>&1; then
    fail_with_log "Phil identity core deployment failed." "$STATE_DIR/deploy-stark.log"
  fi

  if [[ "$(status_field starkCore.ready)" != "true" ]]; then
    fail_with_log "deploy_stark.mjs completed, but the Stark core manifest is still not healthy." "$STATE_DIR/deploy-stark.log"
  fi
}

deploy_4337_if_needed() {
  if [[ "$(status_field aa4337.ready)" == "true" ]]; then
    echo "Phil 4337 stack already healthy. Reusing $AA_MANIFEST_PATH"
    return
  fi

  echo "Deploying Phil 4337 stack..."
  if ! (
    cd "$ROOT_DIR"
    export CHAIN_ID=31337
    export RPC_URL="$RPC_URL"
    export PRIVATE_KEY="$DEFAULT_PRIVATE_KEY"
    export PAYMASTER_SIGNER_KEY="$DEFAULT_PRIVATE_KEY"
    export MOCK_UNLOCK_INBOX=true
    export PAYMASTER_DEPOSIT=0.001
    "$NODE_BIN" scripts/deploy_4337.mjs
  ) >"$STATE_DIR/deploy-4337.log" 2>&1; then
    fail_with_log "Phil 4337 deployment failed." "$STATE_DIR/deploy-4337.log"
  fi

  if [[ "$(status_field aa4337.ready)" != "true" ]]; then
    fail_with_log "deploy_4337.mjs completed, but the 4337 manifest is still not healthy." "$STATE_DIR/deploy-4337.log"
  fi
}

start_prover() {
  if [[ "$(status_field services.prover.healthy)" == "true" ]]; then
    echo "Local prover already healthy. Reusing $PROVER_URL"
    return
  fi

  if port_in_use 8747; then
    fail_with_log "Port 8747 is already in use, but the local prover health endpoint is not healthy."
  fi

  stop_pidfile "$STATE_DIR/local-prover.pid"
  echo "Starting local prover..."
  (
    cd "$ROOT_DIR"
    nohup env \
      LOCAL_PROVER_HOST=127.0.0.1 \
      LOCAL_PROVER_PORT=8747 \
      LOCAL_PROVER_MANIFEST=./cairo/Scarb.toml \
      LOCAL_PROVER_ENABLE_PROVE=true \
      LOCAL_PROVER_ENABLE_VERIFY=false \
      "$NODE_BIN" scripts/proofs/local_prover_server.mjs \
      >"$STATE_DIR/local-prover.log" 2>&1 &
    echo $! >"$STATE_DIR/local-prover.pid"
  )
  wait_for_http "local prover" "$PROVER_URL/health" "services.prover.healthy" "$STATE_DIR/local-prover.log"
}

start_backend() {
  if [[ "$(status_field services.backend.healthy)" == "true" ]]; then
    echo "Backend already healthy. Reusing $SERVER_URL"
    return
  fi

  if port_in_use 8787; then
    fail_with_log "Port 8787 is already in use, but the backend health endpoint is not healthy."
  fi

  stop_pidfile "$STATE_DIR/backend.pid"
  require_executable "$TSX_BIN" "tsx CLI"
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
      "$NODE_BIN" "$TSX_BIN" src/index.ts \
      >"$STATE_DIR/backend.log" 2>&1 &
    echo $! >"$STATE_DIR/backend.pid"
  )
  wait_for_http "backend" "$SERVER_URL/health" "services.backend.healthy" "$STATE_DIR/backend.log"
}

fresh_cleanup() {
  rm -f "$DATABASE_PATH"
  rm -f "$ART_MANIFEST_PATH" "$STARK_MANIFEST_PATH" "$AA_MANIFEST_PATH"
}

start_up() {
  local fresh="${1:-false}"
  require_node_runtime
  if [[ "$fresh" == "true" ]]; then
    local had_tracked_hardhat=false
    if [[ -f "$STATE_DIR/hardhat.pid" ]]; then
      had_tracked_hardhat=true
    fi
    "$0" down >/dev/null 2>&1 || true
    if [[ "$had_tracked_hardhat" == "true" ]]; then
      if ! wait_for_rpc_down; then
        echo "A live RPC is still responding at $RPC_URL after stopping the tracked node."
        echo "Fresh mode will hardhat_reset that live node instead of waiting for it to exit."
      fi
    fi
    fresh_cleanup
  fi

  start_hardhat "$fresh"
  compile_local_contracts
  build_bundle
  deploy_stark_if_needed
  deploy_4337_if_needed
  start_prover
  start_backend

  echo
  echo "Local mock-humanity stack is ready."
  echo "  Node:    $NODE_BIN ($NODE_VERSION)"
  echo "  Chain:   $RPC_URL"
  echo "  Server:  $SERVER_URL/status"
  echo "  Prover:  $PROVER_URL/health"
  echo "  Art:     $ART_MANIFEST_PATH"
  echo "  Stark:   $STARK_MANIFEST_PATH"
  echo "  4337:    $AA_MANIFEST_PATH"
}

stop_down() {
  stop_pidfile "$STATE_DIR/backend.pid"
  stop_pidfile "$STATE_DIR/local-prover.pid"
  stop_pidfile "$STATE_DIR/hardhat.pid"
}

show_status() {
  node "$ROOT_DIR/scripts/local/stack_status.mjs" \
    --chainId 31337 \
    --rpc "$RPC_URL" \
    --server "$SERVER_URL" \
    --prover "$PROVER_URL" \
    --artManifest "$ART_MANIFEST_PATH"
  echo
  echo "Tracked PIDs:"
  echo "  Hardhat: $(cat "$STATE_DIR/hardhat.pid" 2>/dev/null || echo stopped)"
  echo "  Backend: $(cat "$STATE_DIR/backend.pid" 2>/dev/null || echo stopped)"
  echo "  Prover:  $(cat "$STATE_DIR/local-prover.pid" 2>/dev/null || echo stopped)"
}

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  up)
    FRESH=false
    if [[ "${1:-}" == "--fresh" ]]; then
      FRESH=true
    fi
    start_up "$FRESH"
    ;;
  down)
    stop_down
    ;;
  status)
    show_status
    ;;
  clean)
    "$0" down >/dev/null 2>&1 || true
    fresh_cleanup
    ;;
  *)
    echo "Usage: $0 {up [--fresh]|down|status|clean}" >&2
    exit 1
    ;;
esac
