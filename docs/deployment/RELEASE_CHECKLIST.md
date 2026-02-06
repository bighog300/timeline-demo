# Release Checklist

Use this checklist for every preview/production release.

## 1) Pre-Merge Checks

- [ ] Branch is up to date with `main`
- [ ] No secrets committed in code, docs, or logs
- [ ] Any env-variable changes are reflected in `docs/deployment/ENVIRONMENT_MATRIX.md`
- [ ] Any operational behavior changes are reflected in `docs/deployment/RUNBOOK.md`

## 2) Required Automated Checks

Run these commands before approving a production release:

```bash
node scripts/preflight.mjs
node scripts/validate-env.mjs --target=web --env-file .env.example
# run in secret-backed environment for production values
node scripts/validate-env.mjs --target=api --prod
pnpm lint
pnpm test
pnpm build
```

- [ ] `preflight` passes (no hard failures)
- [ ] Web env validation passes
- [ ] API env validation passes in production mode (on real values)
- [ ] Lint/test/build complete successfully

## 3) Deployment Readiness Checks

- [ ] Vercel env vars are set for optional integrations
- [ ] OAuth redirect URI configuration is verified in Google Cloud Console

## 4) Deployment Steps (Execution Order)

1. [ ] Deploy web
2. [ ] Verify API health endpoint returns 200 (`/api/health`)
3. [ ] Run smoke test:
   ```bash
   bash scripts/smoke-test.sh
   ```

## 5) Post-Deploy Functional Verification

- [ ] Web app loads successfully
- [ ] OAuth connect flow completes
- [ ] Metadata search returns results
- [ ] Summary generation succeeds
- [ ] Summary file appears/updates in Google Drive
- [ ] Disconnect/reconnect auth flow behaves correctly

## 6) Observability and Security Verification

- [ ] Web logs reviewed (no failing server actions/functions)
- [ ] No secrets or tokens appear in logs
- [ ] Alerts/monitoring remain green after release window

## 7) Rollback Preparedness

- [ ] Previous stable Vercel deployment identified
- [ ] DB snapshot/backup restore path confirmed (if schema changed)
- [ ] Operator on-call assigned for release window

## 8) Release Record

Record after each release:

- Release date/time:
- Git SHA:
- Web deployment ID:
- Operator:
- Notes/issues observed:
- Rollback required? (yes/no):
