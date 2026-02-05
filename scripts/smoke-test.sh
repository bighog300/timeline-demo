#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"
WEB_URL="${WEB_URL:-}"
HEALTH_PATH="${HEALTH_PATH:-/health}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)
      API_URL="$2"
      shift 2
      ;;
    --web-url)
      WEB_URL="$2"
      shift 2
      ;;
    --health-path)
      HEALTH_PATH="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: scripts/smoke-test.sh --api-url <url> --web-url <url> [--health-path /health]

Options:
  --api-url      Base URL for API (e.g. https://timeline-api.onrender.com)
  --web-url      Base URL for Web app (e.g. https://timeline-app.vercel.app)
  --health-path  Health route path for API (default: /health)

You can also provide API_URL, WEB_URL, HEALTH_PATH as environment variables.
USAGE
      exit 0
      ;;
    *)
      echo "❌ Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$API_URL" || -z "$WEB_URL" ]]; then
  echo "❌ Missing required URLs. Provide --api-url and --web-url (or API_URL and WEB_URL env vars)."
  exit 1
fi

trim_trailing_slash() {
  local v="$1"
  echo "${v%/}"
}

API_URL="$(trim_trailing_slash "$API_URL")"
WEB_URL="$(trim_trailing_slash "$WEB_URL")"

api_health_url="${API_URL}${HEALTH_PATH}"
web_home_url="${WEB_URL}/"

status_code() {
  local url="$1"
  local follow_redirects="${2:-false}"
  if [[ "$follow_redirects" == "true" ]]; then
    curl -sS -L -o /dev/null -w "%{http_code}" "$url"
  else
    curl -sS -o /dev/null -w "%{http_code}" "$url"
  fi
}

is_2xx() {
  [[ "$1" =~ ^2[0-9][0-9]$ ]]
}

echo "🔎 Running smoke tests..."
echo "API health URL: $api_health_url"
echo "Web home URL:   $web_home_url"

api_status="$(status_code "$api_health_url" false)"
web_status="$(status_code "$web_home_url" true)"

if is_2xx "$api_status"; then
  echo "✅ API health check passed ($api_status)"
else
  echo "❌ API health check failed ($api_status) at $api_health_url"
  exit 1
fi

if is_2xx "$web_status"; then
  echo "✅ Web home check passed ($web_status)"
else
  echo "❌ Web home check failed ($web_status) at $web_home_url"
  exit 1
fi

echo "✅ Smoke tests passed."
