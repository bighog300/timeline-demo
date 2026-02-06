# Runbook (Operations + Troubleshooting)

## Day-2 Ops: Common Issues

### reconnect_required (401)
**Symptom**: User session expired or missing.
- Ask the user to re-authenticate via `/connect`.
- Verify `NEXTAUTH_*` and Google OAuth env vars are present.

### drive_not_provisioned (400)
**Symptom**: API requires an app-managed Drive folder but it does not exist.
- Ask the user to visit `/connect` and provision the folder.
- Confirm Drive scopes include metadata access.

### rate_limited (429)
**Symptom**: Too many requests within the rate window.
- Retry after a short delay.
- If it persists, reduce batch size or frequency (especially summarize/search).

### upstream_timeout / upstream_error (504/502)
**Symptom**: Google API timeout or upstream error.
- Retry (automatic backoff applies) and confirm Google API status.
- If persistent, capture timestamps + request IDs from logs.

## How to Diagnose

1. **Check Vercel logs**
   - Look for `error_code` and the `requestId` field in JSON logs.
   - Logs are single-line JSON with `{ level, ts, requestId, route, msg, ... }`.
2. **Reproduce locally**
   - Use the same env vars as Vercel.
   - Run API routes directly (e.g., `curl` against `/api/timeline/*`).
3. **Smoke-test script**
   - `bash scripts/smoke-test.sh`
   - Logs (on failure) are written to `./.smoke-server.log`.

## Observability & Safe Logging

### Using Request IDs
- Every timeline/google API response includes an `x-request-id` header.
- The Timeline UI surfaces the request ID in error banners (copy/pasteable).
- Ask users to include the request ID when reporting issues so you can correlate with Vercel logs.

### Where to Find Logs
- Vercel project logs contain single-line JSON entries.
- Filter by `requestId` and `route` to trace a request end-to-end.

### What Gets Logged
- `request_start` and `request_end` with timing/latency.
- Retry and rate limit events.
- Timing labels around Google Drive/Gmail calls and summarization.

### What Is Intentionally Not Logged
- OAuth tokens, cookies, raw email bodies, or full Drive contents.
- Full search queries (only length/metadata is logged).

### Reporting a Bug
When filing an issue, include:
1. Request ID from the UI or response header.
2. Timestamp of the failure.
3. The route and action taken (e.g., "Summarize selected Gmail items").

## Common Developer Tasks

### Update pnpm lockfile safely
1. `corepack enable`
2. `corepack prepare pnpm@9.15.9 --activate`
3. `pnpm install --frozen-lockfile` (should not change lockfile)
4. If changes are needed, document them and re-run the full release checklist.

### Add a new API route (standardized errors + rate limit)
1. Add the route under `apps/web/app/api/.../route.ts`.
2. Reuse the standardized error helpers and `rateLimit` utilities.
3. Return the error payload shape with `error_code`.
4. Update docs if the route is externally visible.

### Add a new Drive-backed artifact type
1. Define the file naming pattern (e.g., `"<Title> - NewArtifact.json"`).
2. Write the artifact into the app-managed Drive folder.
3. Update index logic to include the new artifact type.
4. Update sync/search to discover and parse it.
