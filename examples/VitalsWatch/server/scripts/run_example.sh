#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required on PATH" >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is required to call the /llm endpoint" >&2
  exit 1
fi

PORT="${PORT:-3333}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
SCENARIO_ID="${SCENARIO_ID:-}"

LOG_FILE="${LOG_FILE:-/tmp/active-meta-mgt-example.log}"

echo "Starting server on port ${PORT} (logs -> ${LOG_FILE})"
PORT="${PORT}" BUN_PORT="${PORT}" bun run src/server.ts >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

cleanup() {
  if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Wait for the server to be ready
for _ in $(seq 1 40); do
  if curl -sf "${BASE_URL}/scenarios" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -sf "${BASE_URL}/scenarios" >/dev/null 2>&1; then
  echo "Server did not become ready; see ${LOG_FILE}" >&2
  exit 1
fi

echo "Server is ready at ${BASE_URL}"
BASE_URL="${BASE_URL}" SCENARIO_ID="${SCENARIO_ID}" bun run src/main.ts

echo "Done. Server logs remain at ${LOG_FILE}"
