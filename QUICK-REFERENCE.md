# Timeline App - Quick Reference Card

## 🎯 Essential URLs

| Service | URL | Notes |
|---------|-----|-------|
| Google Cloud Console | https://console.cloud.google.com | For OAuth setup |
| Vercel Dashboard | https://vercel.com/dashboard | Web deployment |
| OpenAI Platform | https://platform.openai.com | API keys |
| GitHub Repo | https://github.com/YOUR_USERNAME/timeline-app | Your code |

## 🔑 Key Commands

### First-Time Setup
```bash
# Generate lockfile (CRITICAL!)
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install

# Initialize Git
git init
git add .
git commit -m "Initial commit"
git push -u origin main
```

### Local Development
```bash
# Start Web
pnpm dev:web
```

### Generate Secrets
```bash
# SESSION_SECRET (32+ chars)
openssl rand -base64 32

# ENCRYPTION_KEY_BASE64
openssl rand -base64 32
```

## 📋 File Checklist

- [ ] vercel.json
- [ ] .nvmrc
- [ ] .node-version
- [ ] package.json (with vercel scripts)
- [ ] .env.example → .env
- [ ] pnpm-lock.yaml (generated, committed!)
- [ ] .github/workflows/ci.yml

## 🔐 Environment Variables Quick List

See `.env.example` for optional integration keys (OAuth/OpenAI).

## 🚀 Deployment Steps (Quick)

1. **Prepare Repo** → Add files, generate lockfile, push to GitHub
2. **Deploy Web** → Import to Vercel, set env vars
3. **Update OAuth** → Add production redirect URI
4. **Test** → API health → OAuth → Search → Summary → Verify Drive file

## ✅ Verification Checklist

- [ ] API health endpoint returns 200 (`/api/health`)
- [ ] Web app loads
- [ ] OAuth flow completes
- [ ] Can search Gmail/Drive
- [ ] Summary generates
- [ ] File appears in Drive under `Timeline App/Summaries/`
- [ ] Rerun updates same file
- [ ] No errors in logs

## 🐛 Common Issues

| Problem | Solution |
|---------|----------|
| Vercel build fails | Check pnpm-lock.yaml is committed |
| "workspace not found" | Verify vercel:install/build scripts |
| OAuth fails | Check redirect URIs match exactly |
| 403 on pnpm install | `pnpm config set registry https://registry.npmjs.org/` |

## 📚 Documentation Reference

| Document | Purpose |
|----------|---------|
| 00-START-HERE.md | Overview of entire package |
| DEPLOYMENT_GUIDE.md | Detailed step-by-step guide (9 parts) |
| DEPLOYMENT_CHECKLIST.md | Task checklist (23 checkpoints) |
| README_NEW.md | GitHub README (features, quickstart) |
| Original docs/ | Technical specs from bundle |

## 🎯 Critical Success Factors

1. **pnpm-lock.yaml** must be committed
2. **Environment variables** must be complete
3. **OAuth redirect URIs** must match exactly

## ⏱️ Time Estimates

| Task | Time |
|------|------|
| Repository setup | 10 min |
| Database setup | 5-10 min |
| Google OAuth | 10-15 min |
| API deployment | 20-30 min |
| Vercel deployment | 10-15 min |
| Testing | 10-15 min |
| **Total** | **2-3 hours** |

## 🔗 Quick Links

- **Docs:** Read DEPLOYMENT_GUIDE.md Part X
- **Troubleshoot:** DEPLOYMENT_GUIDE.md Part 7
- **Checklist:** DEPLOYMENT_CHECKLIST.md
- **Security:** DEPLOYMENT_GUIDE.md Part 8

## 📞 Support Resources

- Vercel Docs: https://vercel.com/docs
- Render Docs: https://render.com/docs
- Next.js Docs: https://nextjs.org/docs
- Prisma Docs: https://prisma.io/docs
- pnpm Docs: https://pnpm.io

## 💡 Pro Tips

1. Deploy API first, web second
2. Test each component before moving on
3. Keep credentials secure (use password manager)
4. Monitor logs for first 24 hours
5. Take notes of your specific URLs/settings
6. Use the checklist - check off items as you go

---

**Print this page for quick reference during deployment!**

**Version:** 1.0 | **Date:** Feb 5, 2026
