# Deployment Runbook

This runbook is for operators deploying and maintaining Timeline App in preview/production.

## 1) First-Time Deployment

Order matters: **deploy API first, then web**.

### 1.1 API deploy (Render/Railway/Fly)
1. Provision PostgreSQL and capture `DATABASE_URL`.
2. Configure API env vars (at minimum):
   - `NODE_ENV=production`
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `ENCRYPTION_KEY_BASE64`
   - `KEY_VERSION`
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI`
   - `OPENAI_API_KEY`
   - `ADMIN_EMAILS`
   - `PORT=3001`
   - `DRIVE_ADAPTER=google`
3. Deploy API and verify health endpoint:
   ```bash
   curl -i https://<api-domain>/health
   ```

### 1.2 Web deploy (Vercel)
1. Update `vercel.json` rewrite destination from placeholder to real API origin.
   - Temporary API domain currently wired: `https://timeline-demo-2ue2e27s6-craigs-projects-bffb1f7c.vercel.app`.
   - During production cutover, replace this temp domain with the final API origin.
2. Configure Vercel env vars:
   - `API_SERVER_ORIGIN=https://<api-domain>`
   - `NEXT_PUBLIC_API_BASE=/api`
3. Deploy and verify:
   ```bash
   curl -I https://<web-domain>/
   ```

### 1.3 Post-deploy smoke check
```bash
bash scripts/smoke-test.sh --api-url https://<api-domain> --web-url https://<web-domain>
```

## 2) Standard Release Procedure

1. Run local/CI checks:
   ```bash
   node scripts/preflight.mjs
   node scripts/validate-env.mjs --target=web --env-file .env.example
   # run against real API env in your secret-backed environment before prod cutover
   node scripts/validate-env.mjs --target=api --prod
   ```
2. Confirm no placeholder API rewrite remains in `vercel.json`.
3. Deploy API changes first if schema/env changed.
4. Deploy web.
5. Run smoke test.
6. Perform manual OAuth + core functional checks.

## 3) Rollback Procedure

### 3.1 API rollback
1. Roll back API service to previous successful deploy in your host dashboard.
2. If migration introduced incompatibility, restore DB backup/snapshot per provider policy.
3. Re-run API health check.

### 3.2 Web rollback
1. Promote previous successful Vercel deployment to production.
2. Confirm `/api` rewrite still targets a healthy API release.
3. Re-run smoke test.

## 4) Incident Playbooks

### 4.1 Migration failure / API boot failure
**Symptoms:** API deploy fails, health endpoint non-200, startup errors in logs.

Actions:
1. Inspect deploy logs for migration failure.
2. Verify `DATABASE_URL` and SSL settings.
3. Roll back API release.
4. Correct migration/env issue in a patch branch.
5. Redeploy and verify `/health`.

### 4.2 OAuth redirect mismatch
**Symptoms:** Google OAuth errors (`redirect_uri_mismatch`) during login.

Actions:
1. Confirm production callback URL:
   - `https://<web-domain>/api/auth/callback`
2. Update Google OAuth client authorized redirect URIs.
3. Ensure API env `GOOGLE_OAUTH_REDIRECT_URI` exactly matches.
4. Redeploy API if env var changed.

### 4.3 401/403 after deploy
**Symptoms:** Authenticated endpoints fail unexpectedly.

Actions:
1. Verify `SESSION_SECRET` and encryption key continuity across deploys.
2. Check cookie domain/samesite behavior in browser and API logs.
3. Ensure no accidental key rotation without keyring migration plan.

### 4.4 Vercel web can’t reach API
**Symptoms:** Web app loads but API calls fail.

Actions:
1. Verify `API_SERVER_ORIGIN` in Vercel env settings.
2. Confirm `vercel.json` rewrite destination points to live API.
3. Validate API CORS policy if direct cross-origin calls are used.

## 5) Verification Checklist (Operational)

After each production deploy:
1. API health returns 200.
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
