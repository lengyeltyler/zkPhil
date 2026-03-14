#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
FRONTEND_PID=""

cleanup() {
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
  bash "$ROOT_DIR/scripts/run_local_e2e.sh" down >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"
bash scripts/run_local_e2e.sh up

echo
echo "Starting frontend server on http://localhost:${FRONTEND_PORT}"
npx serve . -l "$FRONTEND_PORT" >/tmp/phil_frontend.log 2>&1 &
FRONTEND_PID=$!

echo
echo "Local stack is ready:"
echo "  Mint page:  http://localhost:${FRONTEND_PORT}/frontend/mint.html"
echo "  Backend:    http://127.0.0.1:8787/status"
echo
echo "Press Ctrl+C to stop all local services."

wait "$FRONTEND_PID"
