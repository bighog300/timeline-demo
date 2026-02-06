# Timeline App 🕐

A privacy-first timeline demo that showcases a Next.js App Router UI with API routes under `apps/web/app/api/*`.

## ✨ Features

- **Timeline UI**: Example interface for viewing timeline data
- **App Router API Routes**: JSON endpoints implemented in `apps/web/app/api/*`
- **Monorepo Structure**: A single web app in `apps/web` plus shared types in `packages/shared`
- **Vercel Ready**: Single-project deployment targeting the repo root
- **Phase 2A Summaries to Drive**: Summaries stored as Markdown + JSON artifacts in your provisioned Drive folder

## 🏗️ Architecture

This repository contains one deployable Next.js app and one shared package:

- **`apps/web`**: Next.js web application (UI + API routes under `apps/web/app/api/*`, deployed to Vercel)
- **`packages/shared`**: Shared types and Zod schemas

## 🚀 Quick Start

### Prerequisites

- Node.js 20.x or higher
- pnpm 9.x

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd timeline-demo
   ```

2. **Install dependencies**
   ```bash
   corepack enable
   corepack prepare pnpm@9 --activate
   pnpm install
   ```

3. **(Optional) Local environment overrides**
   ```bash
   cp .env.example .env
   # Edit .env with any local-only extensions
   ```
   `.env.example` is optional for local extensions; it is not required for builds.

4. **Start the development server**
   ```bash
   pnpm dev:web
   ```

5. **Visit the app**
   Open http://localhost:3000

## 📦 Deployment

This repo is designed for a **single-project deployment on Vercel** from the repository root.

See the comprehensive [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions.

### Quick Deploy Summary

1. **Deploy Web to Vercel**
   - Connect GitHub repository
   - If Vercel import shows `Invalid request: should NOT have additional property rootDirectory`, clear any custom Project Settings JSON/deploy-button parameters and leave Root Directory managed in the Vercel UI (set it to `.` for this repo).
   - Configure build commands:
     - Install: `pnpm run vercel:install`
     - Build: `pnpm run vercel:build`
   - Deploy

## 🔑 Environment Variables

See [.env.example](.env.example) for optional local overrides.

### Google OAuth (Phase 1 Foundation)

The Phase 1 “real Timeline” foundation uses NextAuth + Google OAuth in the web app:

1. Create OAuth credentials in Google Cloud Console.
2. Add these redirect URLs:
   - `http://localhost:3000/api/auth/callback/google` (local)
   - `https://<your-vercel-domain>/api/auth/callback/google` (production)
3. Set the required environment variables in Vercel or `.env` locally:
   - `NEXTAUTH_URL`
   - `NEXTAUTH_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_SCOPES` (Gmail + Drive metadata scopes)

`apps/web` reads these variables at runtime; in Vercel, define them in the project’s environment
settings (no build-time secrets required). The UI will fall back to a “Not configured” state when
they are missing.

### Phase 1 Does / Doesn’t Do

- ✅ Google sign-in + connection status
- ✅ Gmail + Drive metadata listing (user-selected items only)
- ✅ Drive folder provisioning for app-owned artifacts
- ✅ Phase 2A: summarize selected Gmail/Drive items and write artifacts to Drive
- ❌ No background scanning (Phase 2A only processes selected items)

### Phase 2A Summaries to Drive

- **How it works**: On `/timeline`, click “Generate summaries” to summarize the selected Gmail + Drive
  items. Summaries are generated deterministically (no external LLM by default) and written into the
  provisioned Drive folder.
- **Drive artifact format**: Each item produces two files in the folder:
  - `"<Title> - Summary.md"` (human-readable summary + highlights)
  - `"<Title> - Summary.json"` (structured `SummaryArtifact` payload)
- **Supported Drive types**:
  - ✅ Google Docs (exported to text/plain)
  - ✅ Text/Markdown files (downloaded as text)
  - ⚠️ Other formats (PDFs/images) return an “Unsupported in Phase 2A” placeholder text
- **Gmail parsing**: Best-effort extraction of `text/plain` with fallback to stripped HTML or message
  snippets.

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run linting
pnpm lint

# Build the web app
pnpm build:web
```

## 🚢 Release / Merge

- Review the [Release Checklist](RELEASE_CHECKLIST.md) before merging.
- Run the local verification suite with:
  ```bash
  bash scripts/release-check.sh
  ```

## 📚 Documentation

- [Start Here](00-START-HERE.md) - Deployment package overview
- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Complete deployment instructions
- [Deployment Checklist](DEPLOYMENT_CHECKLIST.md) - Step-by-step checklist
- [Release Checklist](docs/deployment/RELEASE_CHECKLIST.md) - Release process
- [Runbook](docs/deployment/RUNBOOK.md) - Operations guide
- [Environment Matrix](docs/deployment/ENVIRONMENT_MATRIX.md) - Environment references
- [Quick Reference](QUICK-REFERENCE.md) - Commands and pointers

## 🏛️ Project Structure

```
timeline-demo/
├── apps/
│   └── web/              # Next.js web app (UI + API routes)
│       ├── app/
│       └── components/
├── packages/
│   └── shared/           # Shared types and schemas
├── docs/                 # Documentation
├── scripts/              # Utility scripts
├── vercel.json           # Vercel configuration
├── package.json          # Root package.json with workspaces
├── pnpm-workspace.yaml   # pnpm workspace config
└── pnpm-lock.yaml        # Lockfile (required for Vercel)
```

## 🛠️ Development

### Available Commands

```bash
pnpm dev:web          # Start web dev server
pnpm test             # Run tests
pnpm lint             # Run linting
pnpm build            # Build all packages
pnpm vercel:install   # Install for Vercel
pnpm vercel:build     # Build for Vercel
```

### Troubleshooting

**Issue: pnpm install fails with 403**
```bash
pnpm config get registry
pnpm config set registry https://registry.npmjs.org/
```

See [docs/deployment/RUNBOOK.md](docs/deployment/RUNBOOK.md) for more troubleshooting.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is private and proprietary.

## 🙏 Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Hosted on [Vercel](https://vercel.com/)

---

**Questions?** Check the [documentation](docs/) or open an issue.
