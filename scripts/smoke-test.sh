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

auth_providers=$(curl -sS "${BASE_URL}/api/auth/providers" -w "\n%{http_code}") || true
auth_providers_body=$(printf '%s' "${auth_providers}" | sed '$d')
auth_providers_status=$(printf '%s' "${auth_providers}" | tail -n 1)
if [[ "${auth_providers_status}" == "500" ]]; then
  fail_response "Auth providers (unauth)" "${auth_providers_body}"
fi
if [[ "${auth_providers_status}" == "503" ]]; then
  if ! printf '%s' "${auth_providers_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));if (data?.error !== "not_configured") process.exit(1);'; then
    fail_response "Auth providers (unauth)" "${auth_providers_body}"
  fi
  echo "✅ /api/auth/providers not_configured ok"
elif [[ "${auth_providers_status}" == "200" ]]; then
  echo "✅ /api/auth/providers ok"
else
  fail_response "Auth providers (unauth)" "${auth_providers_body}"
fi

# Calendar page should exist publicly (even if it shows an unauth state in UI)
calendar_page_status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/calendar") || true
if [[ "${calendar_page_status}" != "200" ]]; then
  echo "❌ Calendar page check failed (status ${calendar_page_status})."
  echo "--- Last 50 lines of ${LOG_FILE} ---"
  tail -n 50 "${LOG_FILE}" || true
  exit 1
fi
echo "✅ /calendar page ok"

chat=$(curl -fsS -X POST "${BASE_URL}/api/chat" -H 'content-type: application/json' --data '{"message":"ping"}') || fail_response "Chat" ""
if ! printf '%s' "${chat}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));if (!data || typeof data.reply !== "string" || !Array.isArray(data.suggested_actions)) process.exit(1);'; then
  fail_response "Chat" "${chat}"
fi
echo "✅ /api/chat ok"

# Calendar entries endpoint exists and should reject unauth (401) or be not_configured (503)
calendar_entries=$(curl -sS "${BASE_URL}/api/calendar/entries" -w "\n%{http_code}") || true
calendar_entries_body=$(printf '%s' "${calendar_entries}" | sed '$d')
calendar_entries_status=$(printf '%s' "${calendar_entries}" | tail -n 1)
if [[ "${calendar_entries_status}" != "401" && "${calendar_entries_status}" != "503" ]]; then
  fail_response "Calendar entries (unauth)" "${calendar_entries_body}"
fi
if [[ "${calendar_entries_status}" == "503" ]]; then
  if ! printf '%s' "${calendar_entries_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));if (data?.error !== "not_configured") process.exit(1);'; then
    fail_response "Calendar entries (unauth)" "${calendar_entries_body}"
  fi
fi
echo "✅ /api/calendar/entries unauth ok (${calendar_entries_status})"

disconnect=$(curl -sS -X POST "${BASE_URL}/api/google/disconnect" -w "\n%{http_code}") || true
disconnect_body=$(printf '%s' "${disconnect}" | sed '$d')
disconnect_status=$(printf '%s' "${disconnect}" | tail -n 1)
if [[ "${disconnect_status}" != "401" ]]; then
  fail_response "Google disconnect (unauth)" "${disconnect_body}"
fi
if ! printf '%s' "${disconnect_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Google disconnect (unauth)" "${disconnect_body}"
fi
echo "✅ /api/google/disconnect unauth ok"

drive_cleanup=$(curl -sS -X POST "${BASE_URL}/api/google/drive/cleanup" \
  -H 'content-type: application/json' \
  --data '{"dryRun":true}' \
  -w "\n%{http_code}") || true
drive_cleanup_body=$(printf '%s' "${drive_cleanup}" | sed '$d')
drive_cleanup_status=$(printf '%s' "${drive_cleanup}" | tail -n 1)
if [[ "${drive_cleanup_status}" != "401" ]]; then
  fail_response "Drive cleanup (unauth)" "${drive_cleanup_body}"
fi
if ! printf '%s' "${drive_cleanup_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Drive cleanup (unauth)" "${drive_cleanup_body}"
fi
echo "✅ /api/google/drive/cleanup unauth ok"

summarize=$(curl -sS -X POST "${BASE_URL}/api/timeline/summarize" \
  -H 'content-type: application/json' \
  --data '{"items":[{"source":"gmail","id":"demo"}]}' \
  -w "\n%{http_code}") || true
summarize_body=$(printf '%s' "${summarize}" | sed '$d')
summarize_status=$(printf '%s' "${summarize}" | tail -n 1)
if [[ "${summarize_status}" != "401" ]]; then
  fail_response "Timeline summarize (unauth)" "${summarize_body}"
fi
if ! printf '%s' "${summarize_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline summarize (unauth)" "${summarize_body}"
fi
echo "✅ /api/timeline/summarize unauth ok"

timeline_search=$(curl -sS "${BASE_URL}/api/timeline/search?q=test" -w "\n%{http_code}") || true
timeline_search_body=$(printf '%s' "${timeline_search}" | sed '$d')
timeline_search_status=$(printf '%s' "${timeline_search}" | tail -n 1)
if [[ "${timeline_search_status}" != "401" ]]; then
  fail_response "Timeline search (unauth)" "${timeline_search_body}"
fi
if ! printf '%s' "${timeline_search_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline search (unauth)" "${timeline_search_body}"
fi
echo "✅ /api/timeline/search unauth ok"

artifacts_list=$(curl -sS "${BASE_URL}/api/timeline/artifacts/list" -w "\n%{http_code}") || true
artifacts_list_body=$(printf '%s' "${artifacts_list}" | sed '$d')
artifacts_list_status=$(printf '%s' "${artifacts_list}" | tail -n 1)
if [[ "${artifacts_list_status}" != "401" ]]; then
  fail_response "Timeline artifacts list (unauth)" "${artifacts_list_body}"
fi
if ! printf '%s' "${artifacts_list_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline artifacts list (unauth)" "${artifacts_list_body}"
fi
echo "✅ /api/timeline/artifacts/list unauth ok"

artifacts_read=$(curl -sS "${BASE_URL}/api/timeline/artifacts/read?fileId=demo" -w "\n%{http_code}") || true
artifacts_read_body=$(printf '%s' "${artifacts_read}" | sed '$d')
artifacts_read_status=$(printf '%s' "${artifacts_read}" | tail -n 1)
if [[ "${artifacts_read_status}" != "401" ]]; then
  fail_response "Timeline artifacts read (unauth)" "${artifacts_read_body}"
fi
if ! printf '%s' "${artifacts_read_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline artifacts read (unauth)" "${artifacts_read_body}"
fi
echo "✅ /api/timeline/artifacts/read unauth ok"

selection_list=$(curl -sS "${BASE_URL}/api/timeline/selection/list" -w "\n%{http_code}") || true
selection_list_body=$(printf '%s' "${selection_list}" | sed '$d')
selection_list_status=$(printf '%s' "${selection_list}" | tail -n 1)
if [[ "${selection_list_status}" != "401" ]]; then
  fail_response "Timeline selection list (unauth)" "${selection_list_body}"
fi
if ! printf '%s' "${selection_list_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline selection list (unauth)" "${selection_list_body}"
fi
echo "✅ /api/timeline/selection/list unauth ok"

selection_read=$(curl -sS "${BASE_URL}/api/timeline/selection/read?fileId=foo" -w "\n%{http_code}") || true
selection_read_body=$(printf '%s' "${selection_read}" | sed '$d')
selection_read_status=$(printf '%s' "${selection_read}" | tail -n 1)
if [[ "${selection_read_status}" != "401" ]]; then
  fail_response "Timeline selection read (unauth)" "${selection_read_body}"
fi
if ! printf '%s' "${selection_read_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline selection read (unauth)" "${selection_read_body}"
fi
echo "✅ /api/timeline/selection/read unauth ok"

selection_save=$(curl -sS -X POST "${BASE_URL}/api/timeline/selection/save" \
  -H 'content-type: application/json' \
  --data '{"name":"Demo","items":[]}' \
  -w "\n%{http_code}") || true
selection_save_body=$(printf '%s' "${selection_save}" | sed '$d')
selection_save_status=$(printf '%s' "${selection_save}" | tail -n 1)
if [[ "${selection_save_status}" != "401" ]]; then
  fail_response "Timeline selection save (unauth)" "${selection_save_body}"
fi
if ! printf '%s' "${selection_save_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline selection save (unauth)" "${selection_save_body}"
fi
echo "✅ /api/timeline/selection/save unauth ok"

timeline_index_get=$(curl -sS "${BASE_URL}/api/timeline/index/get" -w "\n%{http_code}") || true
timeline_index_get_body=$(printf '%s' "${timeline_index_get}" | sed '$d')
timeline_index_get_status=$(printf '%s' "${timeline_index_get}" | tail -n 1)
if [[ "${timeline_index_get_status}" != "401" ]]; then
  fail_response "Timeline index get (unauth)" "${timeline_index_get_body}"
fi
if ! printf '%s' "${timeline_index_get_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline index get (unauth)" "${timeline_index_get_body}"
fi
echo "✅ /api/timeline/index/get unauth ok"

timeline_index_rebuild=$(curl -sS -X POST "${BASE_URL}/api/timeline/index/rebuild" -w "\n%{http_code}") || true
timeline_index_rebuild_body=$(printf '%s' "${timeline_index_rebuild}" | sed '$d')
timeline_index_rebuild_status=$(printf '%s' "${timeline_index_rebuild}" | tail -n 1)
if [[ "${timeline_index_rebuild_status}" != "401" ]]; then
  fail_response "Timeline index rebuild (unauth)" "${timeline_index_rebuild_body}"
fi
if ! printf '%s' "${timeline_index_rebuild_body}" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const code=data?.error?.code ?? data?.error_code ?? data?.error;if (code !== "reconnect_required") process.exit(1);'; then
  fail_response "Timeline index rebuild (unauth)" "${timeline_index_rebuild_body}"
fi
echo "✅ /api/timeline/index/rebuild unauth ok"
