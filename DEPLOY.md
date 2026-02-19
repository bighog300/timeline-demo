# Deployment checklist

## Required environment variables
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SCOPES` (must include required Gmail/Drive/Calendar scopes)
- `CRON_SECRET`
- Provider keys used by Timeline summarization (for your selected provider)
- Optional commit marker: `VERCEL_GIT_COMMIT_SHA`

## OAuth and consent
- If Google scopes change, users must reconnect at `/connect` and re-consent.
- If summaries fail with `drive_not_provisioned`, re-run provisioning at `/connect`.

## Deployment sanity checks
1. Verify build identity endpoint:
   - `GET /api/meta/build` returns `{ gitSha, buildTimeISO }`.
2. Verify admin route ships:
   - `GET /admin/ops` should render successfully (not 404).
3. Verify summarize API behavior:
   - Invalid payload returns `400` + `error: "invalid_request"`.
   - Missing Drive folder returns `400` + `error: "drive_not_provisioned"`.
