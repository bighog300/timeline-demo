# Timeline App Deployment Checklist

Use this checklist to ensure a smooth deployment from GitHub to Vercel.

## 📋 Pre-Deployment Setup

### ☐ Step 1: Repository Setup
- [ ] Create empty GitHub repository
- [ ] Extract Timeline-Claude-Handoff-Bundle.zip
- [ ] Copy all files to new directory
- [ ] Add new configuration files:
  - [ ] `vercel.json`
  - [ ] `.nvmrc`
  - [ ] `.node-version`
  - [ ] Updated `package.json` with Vercel scripts
  - [ ] `.env.example`
  - [ ] `setup.sh`
  - [ ] `.github/workflows/ci.yml`
  - [ ] `README.md` (updated)

### ☐ Step 2: Generate Lockfile (CRITICAL!)
```bash
cd timeline-app
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
```
- [ ] Verify `pnpm-lock.yaml` was created
- [ ] Commit lockfile to Git

### ☐ Step 3: Initial Git Commit
```bash
git init
git add .
git commit -m "Initial commit: Timeline app with deployment config"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/timeline-app.git
git push -u origin main
```

---

## 🗄️ Database & Services Setup

### ☐ Step 4: PostgreSQL Database
Choose one:
- [ ] **Option A: Render PostgreSQL**
  - [ ] Create Render account
  - [ ] New → PostgreSQL
  - [ ] Copy Internal Database URL
  
- [ ] **Option B: Railway PostgreSQL**
  - [ ] Create Railway account
  - [ ] New Project → PostgreSQL
  - [ ] Copy connection string
  
- [ ] **Option C: Your own PostgreSQL**
  - [ ] Set up PostgreSQL instance
  - [ ] Create `timeline` database
  - [ ] Configure connection string

### ☐ Step 5: Google Cloud Setup
- [ ] Go to [Google Cloud Console](https://console.cloud.google.com)
- [ ] Create new project: "Timeline App"
- [ ] Enable APIs:
  - [ ] Gmail API
  - [ ] Google Drive API
- [ ] Configure OAuth Consent Screen:
  - [ ] User type: External
  - [ ] Add scopes: openid, email, profile, gmail.readonly, drive.readonly, drive.file
- [ ] Create OAuth 2.0 Credentials:
  - [ ] Application type: Web application
  - [ ] Add redirect URIs:
    - [ ] `http://localhost:3000/api/auth/callback` (development)
    - [ ] `https://your-domain.vercel.app/api/auth/callback` (production - update later)
- [ ] Copy Client ID and Client Secret

### ☐ Step 6: OpenAI Setup
- [ ] Sign up at [OpenAI Platform](https://platform.openai.com)
- [ ] Create API key
- [ ] Copy API key

### ☐ Step 7: Generate Security Keys
```bash
# SESSION_SECRET (32+ characters)
openssl rand -base64 32

# ENCRYPTION_KEY_BASE64 (32 bytes)
openssl rand -base64 32
```
- [ ] Save these keys securely

---

## 🌐 Vercel Deployment

### ☐ Step 8: Deploy to Vercel
- [ ] Sign in to [Vercel](https://vercel.com)
- [ ] New Project
- [ ] Import GitHub repository
- [ ] Configure Project:
  - [ ] Framework Preset: Next.js
  - [ ] Root Directory: `.` (repo root)
  - [ ] Build Command: `pnpm run vercel:build`
  - [ ] Install Command: `pnpm run vercel:install`
  - [ ] Output Directory: `apps/web/.next`
  - [ ] Node Version: 20.x

### ☐ Step 9: Configure Vercel Environment Variables
- [ ] Add optional integration keys as needed (see `.env.example`)
- [ ] Click "Deploy"
- [ ] Wait for deployment to complete
- [ ] Copy Vercel URL (e.g., `https://timeline-app-xyz.vercel.app`)

---

## 🔐 OAuth Finalization

### ☐ Step 13: Update Google OAuth Redirect URIs
- [ ] Go back to Google Cloud Console
- [ ] Navigate to OAuth 2.0 Credentials
- [ ] Edit your OAuth client
- [ ] Add production redirect URI:
  ```
  https://your-domain.vercel.app/api/auth/callback
  ```
- [ ] Save

### ☐ Step 14: Update OAuth Redirect URI
- [ ] Ensure `GOOGLE_OAUTH_REDIRECT_URI` matches your production URL

---

## ✅ Post-Deployment Verification

### ☐ Step 15: Test API
- [ ] Visit API health endpoint: `https://your-app.vercel.app/api/health`
- [ ] Should return OK or 200 status

### ☐ Step 16: Test Web App
- [ ] Visit Vercel URL: `https://your-app.vercel.app`
- [ ] Click "Connect Google"
- [ ] Complete OAuth flow
- [ ] Grant permissions
- [ ] Should redirect back to app

### ☐ Step 17: Test Core Functionality
- [ ] Run metadata search
- [ ] Verify results appear
- [ ] Create a summary
- [ ] Check Google Drive for summary file under `Timeline App/Summaries/`
- [ ] Run summary again (should update same file)
- [ ] Test disconnect (should return 401 and require reconnect)

### ☐ Step 18: Check Logs
- [ ] Review Render logs for errors
- [ ] Review Vercel function logs
- [ ] Ensure no sensitive data in logs

---

## 🎨 Optional: Custom Domain

### ☐ Step 19: Configure Custom Domain (Optional)
- [ ] In Vercel: Settings → Domains
- [ ] Add your custom domain
- [ ] Update DNS records as instructed
- [ ] Update Google OAuth redirect URI with custom domain
- [ ] Update `GOOGLE_OAUTH_REDIRECT_URI` in API env vars

---

## 📊 Monitoring Setup

### ☐ Step 20: Set Up Monitoring
- [ ] Configure Render alerts for API
- [ ] Configure Vercel alerts for web
- [ ] Set up error tracking (optional):
  - [ ] Sentry
  - [ ] LogRocket
  - [ ] DataDog

---

## 🔒 Security Checklist

### ☐ Step 21: Security Review
- [ ] No secrets in Git history
- [ ] Strong `SESSION_SECRET` (32+ chars)
- [ ] Encryption keys properly generated
- [ ] HTTPS enabled on all endpoints
- [ ] OAuth scopes minimized
- [ ] Admin emails configured correctly
- [ ] CORS configured if needed
- [ ] Rate limiting enabled (if applicable)

---

## 📝 Documentation

### ☐ Step 22: Update Documentation
- [ ] Update README with actual URLs
- [ ] Document any custom configurations
- [ ] Add team access instructions
- [ ] Create runbook for operations

---

## ✨ Launch!

### ☐ Step 23: Go Live
- [ ] Announce to team
- [ ] Share production URL
- [ ] Monitor for first 24 hours
- [ ] Gather feedback
- [ ] Plan iterations

---

## 🆘 Troubleshooting Quick Reference

**Build fails on Vercel:**
- Check `pnpm-lock.yaml` is committed
- Verify `vercel:install` and `vercel:build` scripts
- Check Node version is 20.x

**OAuth fails:**
- Verify redirect URIs match exactly
- Check Google OAuth credentials are correct
- Ensure cookies are enabled

**API connection fails:**
- Check `/api/health` in the Vercel deployment
- Review Vercel function logs for errors

**Database connection fails:**
- Check `DATABASE_URL` is correct
- Ensure database is running
- Verify SSL mode if required

---

## 📞 Support

If you encounter issues:
1. Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
2. Review [RUNBOOK.md](RUNBOOK.md)
3. Check application logs
4. Verify all environment variables
5. Test each component individually

---

**Completion Date:** ____________

**Deployed By:** ____________

**Production URLs:**
- Web: ____________
- API: ____________

**Notes:**
