# Timeline App - Complete Deployment Guide

## Overview
This guide covers deploying the Timeline App from GitHub to Vercel as a single Next.js project (UI + API routes).

**Architecture:**
- **Web + API (Next.js)** → Vercel
- **Monorepo** managed with pnpm workspaces

---

## Prerequisites

### Tools Required
- Node.js 20.x
- pnpm 9.17.0 (or compatible)
- Git
- GitHub account
- Vercel account
- Google Cloud Console (for OAuth)
- OpenAI API key

### GitHub Repository Setup
1. **Create empty GitHub repository**
   ```bash
   # On GitHub, create a new repository (e.g., timeline-app)
   # Do NOT initialize with README, .gitignore, or license
   ```

2. **Clone this codebase to your machine**
   ```bash
   git clone <source-repo-or-extract-zip>
   cd Timeline-main
   ```

3. **Initialize Git and push to your GitHub repo**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Timeline app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/timeline-app.git
   git push -u origin main
   ```

---

## Part 1: Critical Missing Files

### 1.1 Create Missing Configuration Files

**File: `vercel.json`** (Root directory)
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "version": 2,
  "buildCommand": "pnpm run vercel:build",
  "installCommand": "pnpm run vercel:install",
  "framework": "nextjs",
  "outputDirectory": "apps/web/.next"
}
```

**File: `.nvmrc`** (Root directory)
```
20
```

**File: `.node-version`** (Root directory)
```
20
```

**Update `package.json`** - Add Vercel scripts:
```json
{
  "name": "timeline-app",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "packageManager": "pnpm@9.17.0",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": "9.17.0"
  },
  "scripts": {
    "dev:web": "pnpm --filter ./apps/web dev",
    "preflight": "node scripts/preflight.mjs",
    "test": "pnpm -r --if-present test",
    "build": "pnpm -r --if-present build",
    "lint": "pnpm -r --if-present lint",
    "vercel:install": "corepack enable && corepack prepare pnpm@9.17.0 --activate && pnpm install --frozen-lockfile",
    "vercel:build": "pnpm --filter ./apps/web build"
  }
}
```

### 1.2 Generate pnpm Lockfile (CRITICAL!)

**This is absolutely required** - Vercel uses `--frozen-lockfile` and will fail without it.

```bash
# From repo root
corepack enable
corepack prepare pnpm@9.17.0 --activate
pnpm install
```

This generates `pnpm-lock.yaml`. **Commit this file!**

```bash
git add pnpm-lock.yaml package.json vercel.json .nvmrc .node-version
git commit -m "Add Vercel configuration and lockfile"
git push origin main
```

---

## Part 2: API (Now Served by Next.js)

The API is now served by the Next.js app at `apps/web/app/api/*`, so there is no separate API deployment. All routes are available under `/api/*` from the same Vercel deployment.

### 2.1 Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project: "Timeline App"
3. Enable APIs:
   - Gmail API
   - Google Drive API
4. Create OAuth 2.0 Credentials:
   - Application type: Web application
   - Authorized redirect URIs:
     - `https://your-domain.vercel.app/api/auth/callback`
     - `http://localhost:3000/api/auth/callback` (for local dev)
   - Copy **Client ID** and **Client Secret**

5. Configure OAuth Consent Screen:
   - User type: External
   - Add scopes:
     - `openid`
     - `email`
     - `profile`
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/drive.file`

---

## Part 3: Vercel Web Deployment

### 3.1 Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "New Project"
3. Import your GitHub repository
4. **Framework Preset:** Next.js
5. **Root Directory:** Keep as `.` (repo root)
6. Click "Configure Project"

### 3.2 Vercel Build Settings

**IMPORTANT:** Override the build settings:

```
Root Directory: /
Build Command: pnpm run vercel:build
Install Command: pnpm run vercel:install
Output Directory: apps/web/.next
Node Version: 20.x
```

### 3.3 Environment Variables

No additional environment variables are required just to build. Add optional integration keys as needed (see `.env.example`).

### 3.4 Deploy

Click **"Deploy"** in Vercel. It will:
1. Clone your repo
2. Install dependencies with `pnpm run vercel:install`
3. Build with `pnpm run vercel:build`
4. Deploy the Next.js app

---

## Part 4: Post-Deployment Verification

### 4.1 Test API Health

```bash
curl https://your-app.vercel.app/api/health
# Should return OK or similar
```

### 4.2 Test Web App

1. Visit your Vercel URL: `https://your-app.vercel.app`
2. Click "Connect Google"
3. Complete OAuth flow
4. Try running a summary
5. Verify:
   - ✅ OAuth connect works
   - ✅ Metadata search returns results
   - ✅ Summary creates markdown in Drive under `Timeline App/Summaries/`
   - ✅ Rerun updates same file
   - ✅ Disconnect returns `401 reconnect_required`

---

## Part 5: Local Development Setup

### 5.1 Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/timeline-app.git
cd timeline-app
corepack enable
corepack prepare pnpm@9.17.0 --activate
pnpm install
```

### 5.2 Environment Setup

Create `.env` in repo root:

```bash
cp .env.example .env
```

Edit `.env`:
```
NODE_ENV=development
PORT=3000

# Database (local Postgres)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/timeline

# Session
SESSION_SECRET=dev-secret-change-in-production
SESSION_TTL_MS=604800000

# Google OAuth
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Encryption
ENCRYPTION_KEY_BASE64=<generate-with-openssl-rand-base64-32>
KEY_VERSION=1

# OpenAI
OPENAI_API_KEY=sk-...

# Admin
ADMIN_EMAILS=your-email@example.com
```

### 5.3 Run Development Server

```bash
pnpm dev:web
```

Visit http://localhost:3000

---

## Part 6: GitHub Workflow Best Practices

### 6.1 Branch Strategy

```bash
# Main branch (protected)
main → Always deployable

# Feature branches
git checkout -b feature/add-new-feature
# Make changes
git add .
git commit -m "feat: add new feature"
git push origin feature/add-new-feature
# Create PR on GitHub
```

### 6.2 Recommended .gitignore Additions

Ensure your `.gitignore` includes:
```
node_modules/
.env
.env.local
.env.production
*.log
.next/
dist/
build/
.DS_Store
*.pnpm-debug.log*
```

### 6.3 CI/CD with GitHub Actions

The repo includes `.github/workflows/ci.yml`. This runs tests on PRs.

### 6.4 Vercel Auto-Deployments

- **Production:** Pushes to `main` auto-deploy to production
- **Preview:** PRs get preview deployments
- Configure branch protection on GitHub:
  - Require PR reviews
  - Require status checks (CI)
  - No direct pushes to `main`

---

## Part 7: Common Issues & Solutions

### Issue 1: "pnpm-lock.yaml not found"
**Solution:** Generate and commit lockfile:
```bash
pnpm install
git add pnpm-lock.yaml
git commit -m "Add lockfile"
git push
```

### Issue 2: Vercel build fails with "workspace not found"
**Solution:** Verify `vercel:install` and `vercel:build` scripts use correct filter:
```json
"vercel:install": "pnpm install --frozen-lockfile --filter ./apps/web...",
"vercel:build": "pnpm --filter ./apps/web build"
```

### Issue 3: API can't connect to database
**Solution:** Check `DATABASE_URL` includes all connection params:
```
postgresql://user:password@host:port/database?sslmode=require
```

### Issue 4: OAuth redirect fails
**Solution:** Update Google OAuth settings with exact URLs:
- Production: `https://your-domain.vercel.app/api/auth/callback`
- Dev: `http://localhost:3000/api/auth/callback`

### Issue 5: CORS errors
**Solution:** Update `CORS_ALLOWED_ORIGINS` in API env:
```
CORS_ALLOWED_ORIGINS=https://your-domain.vercel.app
```

---

## Part 8: Production Checklist

Before going live:

- [ ] `pnpm-lock.yaml` committed
- [ ] API deployed and healthy
- [ ] PostgreSQL database provisioned
- [ ] All environment variables set (API & Web)
- [ ] Google OAuth configured with production URLs
- [ ] OpenAI API key set
- [ ] `SESSION_SECRET` is strong (32+ chars)
- [ ] Encryption keys generated and set
- [ ] Admin emails configured
- [ ] Database migrations run
- [ ] OAuth flow tested
- [ ] Summary generation tested
- [ ] Drive file creation verified
- [ ] Vercel custom domain configured (optional)
- [ ] SSL/HTTPS enabled
- [ ] Error monitoring set up (Sentry/LogRocket)

---

## Part 9: Monitoring & Maintenance

### Vercel
- Monitor deployments in Vercel dashboard
- Check function logs for errors
- Set up alerts for failed deployments

### API Routes (Vercel)
- Monitor function logs in Vercel dashboard
- Keep `/api/health` returning 200

---

## Quick Reference Commands

```bash
# Local development
pnpm dev:web          # Start web on :3000

# Testing
pnpm test             # Run all tests
pnpm lint             # Lint all packages

# Building
pnpm build            # Build all packages
pnpm vercel:build     # Build for Vercel

# Deployment
git push origin main  # Triggers Vercel deploy
```

---

## Support Resources

- **Vercel Docs:** https://vercel.com/docs
- **Prisma Docs:** https://www.prisma.io/docs
- **Next.js Docs:** https://nextjs.org/docs
- **pnpm Docs:** https://pnpm.io

---

## Security Considerations

1. **Never commit secrets** - Use environment variables
2. **Rotate credentials regularly** - Especially `SESSION_SECRET`
3. **Use HTTPS only** in production
4. **Implement rate limiting** on API endpoints
5. **Monitor for suspicious activity**
6. **Keep dependencies updated** - Run `pnpm update` regularly
7. **Review OAuth scopes** - Only request what's needed

---

**Next Steps:** Follow Part 1 to create the missing files, then proceed with Part 2 (API deployment) and Part 3 (Vercel deployment).
