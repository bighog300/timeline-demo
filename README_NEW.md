# Timeline App 🕐

A privacy-first timeline builder that creates AI-powered summaries from your Gmail and Google Drive data. Every summary is stored in your Google Drive - your data, your control.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/timeline-app)

## ✨ Features

- **Privacy-First**: No raw content stored - only derived summaries and metadata
- **Google Integration**: Seamlessly connects with Gmail and Google Drive
- **AI-Powered Summaries**: Intelligent timeline generation using OpenAI
- **Drive as System of Record**: All summaries saved to your Google Drive
- **Secure Sessions**: Server-side session storage with encryption
- **Admin Controls**: Separate admin interface with strict access controls

## 🏗️ Architecture

This is a **monorepo** with three main components:

- **`apps/web`**: Next.js SSR web application (deployed to Vercel)
- **`apps/api`**: Express API server (deployed separately to Render/Fly/Railway)
- **`packages/shared`**: Shared types and Zod schemas

## 🚀 Quick Start

### Prerequisites

- Node.js 20.x or higher
- pnpm 9.15.9
- PostgreSQL (local or hosted)
- Google Cloud Project (for OAuth)
- OpenAI API key

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/timeline-app.git
   cd timeline-app
   ```

2. **Run the setup script**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

   Or manually:
   ```bash
   corepack enable
   corepack prepare pnpm@9.15.9 --activate
   pnpm install
   cp .env.example .env
   # Edit .env with your values
   pnpm db:generate
   pnpm db:migrate
   ```

3. **Start the development servers**
   ```bash
   # Terminal 1 - API
   pnpm dev:api

   # Terminal 2 - Web
   pnpm dev:web
   ```

4. **Visit the app**
   Open http://localhost:3000

## 📦 Deployment

See the comprehensive [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions.

### Quick Deploy Summary

1. **Deploy API First** (Render/Fly/Railway)
   - Set up PostgreSQL database
   - Configure environment variables
   - Deploy from `apps/api` directory

2. **Deploy Web to Vercel**
   - Connect GitHub repository
   - Configure build commands:
     - Install: `pnpm run vercel:install`
     - Build: `pnpm run vercel:build`
   - Set environment variables
   - Deploy

3. **Configure Google OAuth**
   - Set up OAuth credentials in Google Cloud Console
   - Add redirect URIs for both development and production

## 🔑 Environment Variables

### Required for API

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
SESSION_SECRET=<32+ char random string>
ENCRYPTION_KEY_BASE64=<base64 encoded key>
KEY_VERSION=1
GOOGLE_OAUTH_CLIENT_ID=<your-client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<your-secret>
GOOGLE_OAUTH_REDIRECT_URI=https://your-domain.com/api/auth/callback
OPENAI_API_KEY=<your-key>
ADMIN_EMAILS=admin@example.com
```

### Required for Web

```env
API_SERVER_ORIGIN=https://your-api-domain.com
NEXT_PUBLIC_API_BASE=/api
```

See [.env.example](.env.example) for complete list.

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run linting
pnpm lint

# Build all packages
pnpm build
```

## 📚 Documentation

- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Complete deployment instructions
- [PRD](PRD.md) - Product requirements
- [Architecture](ARCHITECTURE.md) - Technical architecture
- [Runbook](RUNBOOK.md) - Operations guide
- [API Spec](API_SPEC.md) - API documentation
- [Environment](ENVIRONMENT.md) - Environment variables reference

## 🏛️ Project Structure

```
timeline-app/
├── apps/
│   ├── api/              # Express API server
│   │   ├── src/
│   │   ├── tests/
│   │   └── prisma/       # Database schema and migrations
│   └── web/              # Next.js web app
│       ├── pages/
│       └── components/
├── packages/
│   ├── shared/           # Shared types and schemas
│   ├── prisma-client/    # Prisma client wrapper
│   └── googleapis/       # Google APIs wrapper
├── docs/                 # Documentation
├── scripts/              # Utility scripts
├── .github/              # GitHub Actions workflows
├── vercel.json           # Vercel configuration
├── package.json          # Root package.json with workspaces
├── pnpm-workspace.yaml   # pnpm workspace config
└── pnpm-lock.yaml        # Lockfile (required for Vercel)
```

## 🔒 Privacy & Security

- **No Raw Content Storage**: Only derived summaries and metadata references
- **Encryption at Rest**: All OAuth tokens encrypted with AES-256-GCM
- **Explicit User Actions**: No background jobs or automatic scanning
- **Drive as Source of Truth**: Every summary written to user's Google Drive
- **Admin Separation**: Strict server-side enforcement of admin access
- **Structured Logging**: Only counts, durations, and error codes logged

## 🛠️ Development

### Available Commands

```bash
pnpm dev:api          # Start API dev server
pnpm dev:web          # Start web dev server
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Run database migrations
pnpm db:reset         # Reset database (dev only)
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

**Issue: Database connection fails**
- Ensure PostgreSQL is running
- Check `DATABASE_URL` in `.env`
- Try: `pnpm db:reset` (dev only)

**Issue: OAuth fails**
- Verify redirect URIs in Google Cloud Console
- Check `GOOGLE_OAUTH_*` environment variables
- Ensure cookies are enabled

See [RUNBOOK.md](RUNBOOK.md) for more troubleshooting.

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
- Powered by [OpenAI](https://openai.com/)
- Hosted on [Vercel](https://vercel.com/)
- Database by [PostgreSQL](https://www.postgresql.org/)

---

**Questions?** Check the [documentation](docs/) or open an issue.
