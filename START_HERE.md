# Start Here: Timeline Demo → Timeline Product Foundation

Welcome! This repo is the handoff-ready foundation for the **Timeline product**. It began as a
Timeline demo and has been incrementally evolved into a product-grade baseline with Drive-backed
storage, standardized errors, indexing, and operational hardening.

## What’s Implemented (by phase)

**Option A / B: Demo UI foundations**
- App Router UI pages for selection and timeline workflows.
- API routes scaffolding under `apps/web/app/api/*`.

**Option C (Phase 1–4C): Real product foundation**
- **Phase 1**: Google OAuth + connection status, Drive folder provisioning.
- **Phase 2A**: Summaries written to Drive (`Summary.json` + `.md`).
- **Phase 2B**: Sync summaries from Drive (rehydrate local cache).
- **Phase 2C**: Selection sets saved/loaded from Drive.
- **Phase 3B**: Drive-scoped search for Summary + Selection artifacts.
- **Phase 4A**: Standardized error model + rate limiting + retry/backoff.
- **Phase 4B**: Drive index (`timeline-index.json`) for faster lists/search.
- **Phase 4C**: Timeline UX improvements + hardening for real-world usage.

## Product Constraints (Core Design Principles)
- **No background scanning**: everything happens only on user action.
- **Drive-backed ownership**: Google Drive folder is the source of truth.
- **DB is optional/cache only**: any local DB is treated as a cache; Drive artifacts are canonical.

## Privacy & Data Handling
- **What is processed**: Gmail + Drive content is fetched only for items the user selects; no background scanning.
- **Stored in Drive**: summaries (`.md` + `.json`), selection sets, and the timeline index inside the app-managed folder.
- **Stored locally**: browser localStorage caches for selections, recent summaries, and last sync timestamp.
- **Cached only**: UI preferences (filters, grouping, auto-sync) stay in the browser.
- **Logging**: request IDs and timings only. Tokens, file contents, and full request bodies are never logged.

## Quickstart (Local)

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm run vercel:build
node scripts/verify-build.mjs
bash scripts/smoke-test.sh
```

## Auth Routing Guardrail (Required)
- **NextAuth v4 is locked to the Pages Router** (`apps/web/pages/api/auth/[...nextauth].ts`).
- **Do not add App Router auth routes** (e.g. `apps/web/app/api/auth/*`). These cause a
  `req.query.nextauth` crash and OAuth callback 500s in production.
- Guardrail: `node scripts/verify-auth-routing.mjs` (also runs in `scripts/release-check.sh`).

## Quickstart (with Google creds)

**Required env vars** (local `.env` or Vercel environment settings):
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SCOPES`

**Redirect URLs (OAuth):**
- Local: `http://localhost:3000/api/auth/callback/google`
- Prod: `https://<your-vercel-domain>/api/auth/callback/google`

**Flow:**
1. Visit `/connect` to connect Google and provision the Drive folder.
2. Select Gmail/Drive items on `/select/gmail` or `/select/drive`.
3. On `/timeline`, click **Summarize** to generate artifacts.
4. Use **Sync** to rehydrate, **Index** to update the Drive index, and **Search** to query artifacts.

## Deploy to Vercel (High-level)

- The repo is set up for a **single Vercel project** from the repo root.
- Use `vercel.json` as-is and standard build commands:
  - Install: `pnpm run vercel:install`
  - Build: `pnpm run vercel:build`
- See `vercel.json` and `DEPLOYMENT_GUIDE.md` for full details.
