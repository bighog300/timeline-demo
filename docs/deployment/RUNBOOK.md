# Deployment Runbook

This runbook is for operators deploying and maintaining Timeline App in preview/production.

## 1) First-Time Deployment

The app deploys as a single Next.js project (UI + API routes) from the repo root.

### 1.1 Web deploy (Vercel)
> Vercel project setup note: set **Root Directory = `.` (repo root)**.
> The root `vercel.json` controls install/build/output for `apps/web`.

1. Configure Vercel build settings:
   - Install: `pnpm run vercel:install`
   - Build: `pnpm run vercel:build`
   - Output Directory: `apps/web/.next`
2. Add optional integration env vars as needed (see `.env.example`).
3. Deploy and verify:
   ```bash
   curl -I https://<web-domain>/
   ```

### 1.2 Post-deploy smoke check
```bash
bash scripts/smoke-test.sh --web-url https://<web-domain>
```

## 2) Standard Release Procedure

1. Run local/CI checks:
   ```bash
   node scripts/preflight.mjs
   node scripts/validate-env.mjs --target=web --env-file .env.example
   node scripts/validate-env.mjs --target=api --prod
   ```
2. Deploy web.
3. Run smoke test.
4. Perform manual OAuth + core functional checks.

## 3) Rollback Procedure

1. Promote the previous successful Vercel deployment to production.
2. Re-run smoke test.

## 4) Incident Playbooks

### 4.1 API route failure
**Symptoms:** `/api/*` endpoints return non-200 or throw errors.

Actions:
1. Inspect Vercel function logs for the failing route.
2. Verify environment variables and integration credentials.
3. Roll back the Vercel deployment if needed.

### 4.2 OAuth redirect mismatch
**Symptoms:** Google OAuth errors (`redirect_uri_mismatch`) during login.

Actions:
1. Confirm production callback URL:
   - `https://<web-domain>/api/auth/callback`
2. Update Google OAuth client authorized redirect URIs.
3. Ensure `GOOGLE_OAUTH_REDIRECT_URI` matches.

### 4.3 401/403 after deploy
**Symptoms:** Authenticated endpoints fail unexpectedly.

Actions:
1. Verify `SESSION_SECRET` and encryption key continuity across deploys.
2. Check cookie domain/samesite behavior in browser logs.
3. Ensure no accidental key rotation without a migration plan.

## 5) Verification Checklist (Operational)

After each production deploy:
1. API health returns 200 (`/api/health`).
2. Web home route returns 200.
3. OAuth connect flow completes.
4. Metadata search returns results.
5. Summary generation succeeds and file appears/updates in Drive.
6. Logs show no recurring errors or secret leakage.

## 6) Security and Rotation

- Rotate `SESSION_SECRET` and `ENCRYPTION_KEY_BASE64` after suspected compromise.
- Use separate OpenAI keys for preview vs production.
- Never store live secrets in repository files.
- Keep admin allowlist (`ADMIN_EMAILS`) tightly scoped.
