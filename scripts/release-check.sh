#!/usr/bin/env bash

set -uo pipefail

run_step() {
  local label="$1"
  shift
  echo "\n==> ${label}"
  if "$@"; then
    echo "PASS: ${label}"
  else
    echo "FAIL: ${label}"
    exit 1
  fi
}

run_step "Enable Corepack" corepack enable
run_step "Activate pnpm 9.15.9" corepack prepare pnpm@9.15.9 --activate
run_step "Install dependencies" pnpm install --frozen-lockfile
run_step "Run tests" pnpm test
run_step "Vercel build" pnpm run vercel:build
run_step "Verify build" node scripts/verify-build.mjs
run_step "Verify docs" node scripts/verify-docs.mjs
run_step "Smoke test" bash scripts/smoke-test.sh

echo "\nAll release checks passed."
