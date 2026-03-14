#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

resolve_node() {
  if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
    echo "${NODE_BIN}"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  if [[ -x "${REPO_ROOT}/.tools/node-v20.19.1-darwin-arm64/bin/node" ]]; then
    echo "${REPO_ROOT}/.tools/node-v20.19.1-darwin-arm64/bin/node"
    return 0
  fi
  if [[ -x "${REPO_ROOT}/.tools/node-v18.20.4-darwin-arm64/bin/node" ]]; then
    echo "${REPO_ROOT}/.tools/node-v18.20.4-darwin-arm64/bin/node"
    return 0
  fi
  echo "node binary not found. Install Node.js or set NODE_BIN." >&2
  return 1
}

NODE_EXEC="$(resolve_node)"
exec "${NODE_EXEC}" "${SCRIPT_DIR}/scripts/prove.mjs" "$@"
