# Timeline — Deployment & CI Guide

## 1. Environment
- Node 20
- pnpm 9.15.9

## 2. Required Environment Variables
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SCOPES`

Optional:
- `DATABASE_URL`
- `DIRECT_URL`
- `OPENAI_API_KEY` (future)
- Gemini key/envs (future)

## 3. Local Verification
```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm run vercel:build
node scripts/verify-build.mjs
```

## 4. Vercel Configuration
- Deploy from repo root
- Install: `pnpm run vercel:install`
- Build: `pnpm run vercel:build`
- Output: `apps/web/.next`

## 5. Post-Deploy Checklist
- OAuth redirect URIs configured
- `/connect` provisions Drive folder
- Selection pages load
- Summarize writes artifacts
- Index rebuild works
- Search works

## 6. CI Safeguards
- `scripts/verify-auth-routing.mjs`
- build verification script(s)
- smoke tests
