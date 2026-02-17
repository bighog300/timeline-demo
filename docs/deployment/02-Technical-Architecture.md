# Timeline — Technical Architecture Specification

## 1. Stack
- Next.js (App Router)
- NextAuth (Pages Router for auth)
- TypeScript
- pnpm workspace
- Optional Prisma (cache only)
- Google APIs (Gmail + Drive)

## 2. Repo Structure
- `apps/web` — Next.js app
- `packages/shared` — Zod schemas/types
- `scripts` — verification + build utilities

## 3. Canonical Data Model
Drive folder (app-managed) contains:
- Summary.json
- Summary.md
- Selection.json
- timeline-index.json
- AdminSettings.json

Database (optional) stores:
- run metadata
- transient indexing cache

Drive is always source of truth.

## 4. API Surface Overview
- `/api/timeline/summarize`
- `/api/timeline/search`
- `/api/timeline/index`
- `/api/timeline/artifacts/list`
- `/api/google/gmail/*`
- `/api/google/drive/*`
- `/api/selection-sets/*`
- `/api/admin/settings/*`
- `/api/chat` (scaffold)
- `/api/calendar` (scaffold)

## 5. Summarisation Flow
1. Validate session
2. Validate Drive folder
3. Fetch selected sources
4. Run summarizer
5. Write artifacts to Drive
6. Return artifact metadata

## 6. Error Model
Standardized error payload:
```json
{
  "error": { "code": "bad_request", "message": "..." },
  "error_code": "bad_request"
}
```

## 7. LLM Provider Abstraction (Planned)
Interface:
- `summarize({ title, text, metadata, settings })`

Providers:
- `stub`
- `openai` (Responses API)
- `gemini`

Configured via Drive-backed Admin settings file.

## 8. Security
- OAuth token scoped to selected resources
- No content logging
- Request ID tracing
- Rate limiting
