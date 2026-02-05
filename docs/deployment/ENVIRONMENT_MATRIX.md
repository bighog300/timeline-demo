# Environment Matrix

This matrix defines required configuration for each runtime surface (`api`, `web`) across environments (`local`, `preview`, `production`).

> **Policy:** Never commit real secrets. Store production values in your hosting platform secret manager (Render, Vercel, etc.).

## Ownership and Secret Sources

| Category | Owner | Secret Source |
|---|---|---|
| Database credentials | Backend owner | Render/Railway/Fly managed secret store |
| Session and encryption keys | Backend owner | Secret manager + password manager backup |
| OAuth client credentials | Platform owner | Google Cloud Console + secret manager |
| OpenAI API key | AI/platform owner | OpenAI dashboard + secret manager |
| Web runtime config | Frontend/platform owner | Vercel environment variables |

## API Variables

| Variable | Local | Preview | Production | Required | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` | Yes | Keep API process in production mode outside local dev. |
| `PORT` | `3001` | platform assigned or `3001` | platform assigned or `3001` | Yes | Must match host runtime expectations. |
| `DATABASE_URL` | Local Postgres DSN | Managed preview DB DSN | Managed prod DB DSN | Yes | Use SSL parameters when required by provider. |
| `SESSION_SECRET` | Dev-only random string | Strong random 32+ chars | Strong random 32+ chars | Yes | Rotate during incidents. |
| `ENCRYPTION_KEY_BASE64` | Dev key | 32-byte base64 key | 32-byte base64 key | Yes | Must be generated securely. |
| `KEY_VERSION` | `1` | `1` (or active key version) | `1` (or active key version) | Yes | Increment when rotating key material. |
| `GOOGLE_OAUTH_CLIENT_ID` | Local OAuth app | Preview OAuth app | Production OAuth app | Yes | Avoid reusing prod client in local where possible. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Local OAuth secret | Preview OAuth secret | Production OAuth secret | Yes | Keep only in secret manager, never in repo. |
| `GOOGLE_OAUTH_REDIRECT_URI` | `http://localhost:3000/api/auth/callback` | Preview app callback URL | Production app callback URL | Yes | Must exactly match Google OAuth config. |
| `OPENAI_API_KEY` | Dev/test key | Scoped preview key | Production key | Yes | Use separate keys per environment if possible. |
| `ADMIN_EMAILS` | Your email(s) | Test admin list | Production admin list | Yes | Comma-separated allowlist. |
| `DRIVE_ADAPTER` | `google` or `stub` | `google` | `google` | Yes | Use `stub` only for controlled local testing. |

## Web Variables

| Variable | Local | Preview | Production | Required | Notes |
|---|---|---|---|---|---|
| `API_SERVER_ORIGIN` | `http://localhost:3001` | Preview API origin | Prod API origin | Yes | Must point to deployed API host. |
| `NEXT_PUBLIC_API_BASE` | `/api` | `/api` | `/api` | Yes | Keep as `/api` when using Vercel rewrites. |
| `NEXT_PUBLIC_APP_BASE_URL` | Optional local URL | Preview URL | Production URL | Optional | Useful for absolute links or metadata. |

## Validation Commands

Use these checks before cutting a release:

```bash
# Repository preflight checks (files/scripts/vercel rewrite)
node scripts/preflight.mjs

# Validate web env against template
node scripts/validate-env.mjs --target=web --env-file .env.example

# Validate API env in strict prod mode (will fail on placeholders)
node scripts/validate-env.mjs --target=api --env-file .env.example --prod
```

## Rotation and Incident Notes

- Rotate `SESSION_SECRET` and `ENCRYPTION_KEY_BASE64` after suspected compromise.
- After OAuth client rotation, update both Google Console redirect URIs and API env vars together.
- Prefer separate OpenAI keys per environment to simplify revocation and blast-radius control.
