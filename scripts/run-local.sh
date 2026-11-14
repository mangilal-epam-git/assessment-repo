#!/usr/bin/env bash
# Starts the mock providers and the best-offers service, waits for both to be
# healthy, and shuts both down cleanly on Ctrl+C.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MOCK_PORT="${MOCK_PORT:-8081}"
PORT="${PORT:-8080}"

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${SERVICE_PID:-}" ]] && kill "$SERVICE_PID" 2>/dev/null || true
  [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Stopped."
}
trap cleanup EXIT INT TERM

wait_for() {
  local url="$1" name="$2" attempts=50
  for ((i = 1; i <= attempts; i++)); do
    if node -e "fetch('$url').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      echo "$name is ready"
      return 0
    fi
    sleep 0.2
  done
  echo "ERROR: $name did not become ready at $url" >&2
  return 1
}

echo "Starting mock providers on :$MOCK_PORT"
MOCK_PORT="$MOCK_PORT" node src/mock-providers/server.js &
MOCK_PID=$!
wait_for "http://127.0.0.1:$MOCK_PORT/healthz" "mock-providers"

echo "Starting best-offers on :$PORT"
PORT="$PORT" \
PROVIDER_TELEMETRY1_URL="http://127.0.0.1:$MOCK_PORT/provider/telemetry1" \
PROVIDER_TELEMETRY2_URL="http://127.0.0.1:$MOCK_PORT/provider/telemetry2" \
FIXED_CLOCK="${FIXED_CLOCK:-2026-06-15T10:05:00Z}" \
ADMIN_TOKEN="${ADMIN_TOKEN:-local-dev-admin-token}" \
  node src/best-offers/server.js &
SERVICE_PID=$!
wait_for "http://127.0.0.1:$PORT/healthz" "best-offers"

cat <<BANNER

  Ready.
    curl http://127.0.0.1:$PORT/best-offers
    curl http://127.0.0.1:$PORT/metrics
    curl http://127.0.0.1:$PORT/readyz

  Press Ctrl+C to stop both processes.

BANNER

wait
