#!/usr/bin/env bash
set -euo pipefail

HOST=127.0.0.1
PORT=3000
BASE_URL="http://${HOST}:${PORT}"
LOG_FILE="./.smoke-server.log"
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

fail_response() {
  local label=$1
  local response=$2

  echo "❌ ${label} check failed."
  echo "Response:"
  echo "${response}"
  echo "--- Last 50 lines of ${LOG_FILE} ---"
  tail -n 50 "${LOG_FILE}" || true
  exit 1
}

trap cleanup EXIT

rm -f "${LOG_FILE}"

pnpm --filter ./apps/web start --port "${PORT}" >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

ready=0
for _ in {1..60}; do
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

  if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>/dev/null; then
    ready=1
    break
  fi

  sleep 1
done

if [[ ${ready} -ne 1 ]]; then
  echo "❌ Server did not become ready within 60 seconds."
  echo "--- Last 50 lines of ${LOG_FILE} ---"
  tail -n 50 "${LOG_FILE}" || true
  exit 1
fi

health=$(curl -fsS "${BASE_URL}/api/health") || fail_response "Health" ""
if ! printf '%s' "${health}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));if (!data || data.ok !== true) process.exit(1);'; then
  fail_response "Health" "${health}"
fi
echo "✅ /api/health ok"

events=$(curl -fsS "${BASE_URL}/api/events") || fail_response "Events" ""
if ! printf '%s' "${events}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));if (!Array.isArray(data)) process.exit(1);'; then
  fail_response "Events" "${events}"
fi
echo "✅ /api/events ok"

calendar=$(curl -fsS "${BASE_URL}/api/calendar") || fail_response "Calendar" ""
if ! printf '%s' "${calendar}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));if (!data || !Array.isArray(data.items)) process.exit(1);if (data.items.length && !data.items.every(item => item && item.id && item.title && item.start && item.end)) process.exit(1);'; then
  fail_response "Calendar" "${calendar}"
fi
echo "✅ /api/calendar ok"

chat=$(curl -fsS -X POST "${BASE_URL}/api/chat" -H 'content-type: application/json' --data '{"message":"ping"}') || fail_response "Chat" ""
if ! printf '%s' "${chat}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));if (!data || typeof data.reply !== "string" || !Array.isArray(data.suggested_actions)) process.exit(1);'; then
  fail_response "Chat" "${chat}"
fi
echo "✅ /api/chat ok"
