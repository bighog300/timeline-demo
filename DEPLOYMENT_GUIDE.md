# Timeline App - Complete Deployment Guide

## Overview
This guide covers deploying the Timeline App from GitHub to Vercel (web) and a separate hosting service (API).

**Architecture:**
- **Web (Next.js)** → Vercel
- **API (Express + PostgreSQL)** → Render/Fly/Railway
- **Monorepo** managed with pnpm workspaces

---

## Prerequisites

### Tools Required
- Node.js 20.x
- pnpm 9.15.9 (or compatible)
- Git
- GitHub account
- Vercel account
- API hosting account (Render/Fly/Railway)
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
  "outputDirectory": "apps/web/.next",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-api-domain.com/:path*"
    }
  ]
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
  "packageManager": "pnpm@9.15.9",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": "9.15.9"
  },
  "scripts": {
    "dev:api": "pnpm --filter ./apps/api dev",
    "dev:web": "pnpm --filter ./apps/web dev",
    "db:generate": "pnpm --filter ./apps/api db:generate",
    "db:migrate": "pnpm --filter ./apps/api db:migrate",
    "db:reset": "pnpm --filter ./apps/api db:reset",
    "preflight": "node scripts/preflight.mjs",
    "test": "pnpm -r --if-present test",
    "build": "pnpm -r --if-present build",
    "lint": "pnpm -r --if-present lint",
    "vercel:install": "corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm install --frozen-lockfile --filter ./apps/web...",
    "vercel:build": "pnpm --filter ./apps/web build"
  }
}
```

### 1.2 Generate pnpm Lockfile (CRITICAL!)

**This is absolutely required** - Vercel uses `--frozen-lockfile` and will fail without it.

```bash
# From repo root
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
```

This generates `pnpm-lock.yaml`. **Commit this file!**

```bash
git add pnpm-lock.yaml package.json vercel.json .nvmrc .node-version
git commit -m "Add Vercel configuration and lockfile"
git push origin main
```

---

## Part 2: API Deployment (Deploy First!)

The API must be deployed **before** the web app, as the web app needs the API URL.

### 2.1 Choose Your API Hosting Provider

**Recommended Options:**
- **Render** (easiest, has free tier)
- **Fly.io** (more control, free allowance)
- **Railway** (simple, pay-as-you-go)

### 2.2 Deploy to Render (Example)

1. **Create Render account** at https://render.com

2. **Create PostgreSQL database:**
   - Click "New +" → "PostgreSQL"
   - Name: `timeline-db`
   - Region: Choose closest to you
   - Plan: Free or Starter
   - Copy the **Internal Database URL** (starts with `postgresql://`)

3. **Create Web Service:**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Settings:
     - **Name:** `timeline-api`
     - **Region:** Same as database
     - **Branch:** `main`
     - **Root Directory:** `apps/api`
     - **Runtime:** Node
     - **Build Command:** 
       ```bash
       corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm install --frozen-lockfile && pnpm db:generate && pnpm db:migrate && pnpm build
       ```
     - **Start Command:** 
       ```bash
       pnpm start
       ```

4. **Configure Environment Variables** (in Render dashboard):
   ```
   NODE_ENV=production
   DATABASE_URL=<your-internal-database-url>
   SESSION_SECRET=<generate-random-32+-char-string>
   ENCRYPTION_KEY_BASE64=<generate-base64-key>
   KEY_VERSION=1
   GOOGLE_OAUTH_CLIENT_ID=<from-google-console>
   GOOGLE_OAUTH_CLIENT_SECRET=<from-google-console>
   GOOGLE_OAUTH_REDIRECT_URI=https://your-web-domain.vercel.app/api/auth/callback
   OPENAI_API_KEY=<your-openai-key>
   ADMIN_EMAILS=your-email@example.com
   PORT=3001
   ```

5. **Generate Secure Keys:**
   ```bash
   # SESSION_SECRET (32+ chars)
   openssl rand -base64 32
   
   # ENCRYPTION_KEY_BASE64 (32 bytes)
   openssl rand -base64 32
   ```

6. **Deploy** and note the API URL (e.g., `https://timeline-api.onrender.com`)

### 2.3 Google OAuth Setup

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
Build Command: pnpm run vercel:build
Install Command: pnpm run vercel:install
Output Directory: apps/web/.next
Node Version: 20.x
```

### 3.3 Environment Variables

Add these in Vercel dashboard:

```
API_SERVER_ORIGIN=https://your-api-domain.onrender.com
NEXT_PUBLIC_API_BASE=/api
```

**Note:** The `API_SERVER_ORIGIN` should point to your deployed API (from Part 2).

### 3.4 Update vercel.json with Real API URL

After API is deployed, update `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "version": 2,
  "buildCommand": "pnpm run vercel:build",
  "installCommand": "pnpm run vercel:install",
  "framework": "nextjs",
  "outputDirectory": "apps/web/.next",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://timeline-api.onrender.com/:path*"
    }
  ]
}
```

Commit and push:
```bash
git add vercel.json
git commit -m "Update API rewrite URL"
git push origin main
```

Vercel will auto-deploy.

### 3.5 Deploy

Click **"Deploy"** in Vercel. It will:
1. Clone your repo
2. Install dependencies with `pnpm run vercel:install`
3. Build with `pnpm run vercel:build`
4. Deploy the Next.js app

---

## Part 4: Post-Deployment Verification

### 4.1 Test API Health

```bash
curl https://your-api-domain.onrender.com/health
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
corepack prepare pnpm@9.15.9 --activate
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
PORT=3001
WEB_PORT=3000
API_SERVER_ORIGIN=http://localhost:3001

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

### 5.3 Database Setup

```bash
# Install PostgreSQL locally (macOS)
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb timeline

# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate
```

### 5.4 Run Development Servers

```bash
# Terminal 1 - API
pnpm dev:api

# Terminal 2 - Web
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
apps/api/.prisma/
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

### API (Render)
- Monitor logs in Render dashboard
- Set up health check endpoints
- Configure auto-deploy on push

### Database
- Regular backups (Render does this automatically)
- Monitor connection pool usage
- Scale when needed

---

## Quick Reference Commands

```bash
# Local development
pnpm dev:api          # Start API on :3001
pnpm dev:web          # Start web on :3000
pnpm db:migrate       # Run migrations
pnpm db:reset         # Reset DB (dev only)

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
- **Render Docs:** https://render.com/docs
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
