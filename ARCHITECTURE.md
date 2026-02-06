# Architecture Overview

## Monorepo Structure (and why)
This repo uses a lightweight monorepo layout to keep the **web app** and **shared types/schemas**
in one place. It enables tight coupling between API + UI + shared types without publishing
packages.

```
apps/web        # Next.js App Router UI + API routes
packages/shared # Shared types + Zod schemas
scripts         # Repo verification & automation utilities
```

## Next.js App Router Layout
- **UI pages** live under `apps/web/app/*`.
- **API routes** live under `apps/web/app/api/*` and follow App Router conventions.
- The app is deployed as a single Next.js project from the repo root.

## API Routes Map

**Google provisioning/listing**
- `/api/google/provision` — create the app-managed Drive folder
- `/api/google/list` — list Gmail + Drive items for selection

**Timeline workflows**
- `/api/timeline/summarize` — summarize selected items, write artifacts to Drive
- `/api/timeline/artifacts` — list summary artifacts (and metadata)
- `/api/timeline/selection` — save/load selection sets
- `/api/timeline/search` — Drive-scoped search for summaries and selections
- `/api/timeline/index` — rebuild `timeline-index.json` for faster list/search

## Drive Folder = Source of Truth
All artifacts live inside a **single app-managed Drive folder** that the user provisions in `/connect`.
This folder is the canonical system of record.

### Artifact Naming Conventions
- `"<Title> - Summary.json"`
- `"<Title> - Summary.md"`
- `"<SelectionName> - Selection.json"`
- `"timeline-index.json"` (metadata-only index)

## Data Flow (Text Diagrams)

**Select → Summarize → Write → Sync → Search**
```
Select items (Gmail/Drive)
        ↓
Summarize items (API)
        ↓
Write artifacts to Drive
        ↓
Sync artifacts into local cache
        ↓
Search scans Drive artifacts (+ index)
```

**Index refresh**
```
Drive artifacts → build timeline-index.json → list/search uses index → fewer Drive calls
```

## Error Model (Phase 4A)
All API routes return standardized error payloads:
```json
{
  "error": { "code": "rate_limited", "message": "Too many requests." },
  "error_code": "rate_limited"
}
```
UI components use `error_code` to show actionable guidance (reconnect, provision, retry).

## Rate Limiting + Retry/Backoff
- **Rate limiting**: in-process, best-effort (per-user or per-IP). Limits reset between serverless
  cold starts, so it is protective but not absolute.
- **Retry/backoff**: transient Google API failures (429/5xx) are retried with exponential backoff,
  honoring `Retry-After` when present.

## Performance Notes
- The **index file** (`timeline-index.json`) stores metadata-only references to artifacts to avoid
  repeatedly listing/downloading every JSON file.
- **Partial scan behavior**: search caps the number of JSON files it downloads per request. If the
  cap is reached, results are marked partial and the UI prompts the user to refine their query.
