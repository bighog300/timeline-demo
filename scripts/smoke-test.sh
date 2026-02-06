#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="./.smoke-server.log"
HEALTH_URL="http://127.0.0.1:3000/api/health"
MAX_ATTEMPTS=60
SLEEP_SECONDS=1
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

rm -f "${LOG_FILE}"

pnpm --filter ./apps/web start --port 3000 >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

attempt=1
while [[ ${attempt} -le ${MAX_ATTEMPTS} ]]; do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    if wait "${SERVER_PID}"; then
      exit_status=0
    else
      exit_status=$?
    fi
    echo "❌ Server process exited early with status ${exit_status}."
    echo "--- Last 50 lines of ${LOG_FILE} ---"
    tail -n 50 "${LOG_FILE}" || true
    exit 1
  fi

  if response=$(curl -sS -m 2 "${HEALTH_URL}" 2>/dev/null); then
    echo "✅ Server is ready. Health response:"
    echo "${response}"
    exit 0
  fi

  sleep "${SLEEP_SECONDS}"
  attempt=$((attempt + 1))
done

if kill -0 "${SERVER_PID}" 2>/dev/null; then
  kill "${SERVER_PID}" 2>/dev/null || true
fi
if wait "${SERVER_PID}"; then
  exit_status=0
else
  exit_status=$?
fi

echo "❌ Server did not become ready within ${MAX_ATTEMPTS} seconds."
echo "Process exit status: ${exit_status}"
echo "--- Last 50 lines of ${LOG_FILE} ---"
tail -n 50 "${LOG_FILE}" || true
exit 1
