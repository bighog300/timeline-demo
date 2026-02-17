# Timeline — API Specification

## Authentication
- `GET/POST /api/auth/[...nextauth]`

## Timeline
### `POST /api/timeline/summarize`
Input:
```json
{ "items": [ { "source": "gmail|drive", "id": "string" } ] }
```
Output:
```json
{ "artifacts": [], "failed": [] }
```

### `POST /api/timeline/search`
Input:
```json
{ "query": "string" }
```

### `POST /api/timeline/index`
Rebuilds `timeline-index.json`.

### `GET /api/timeline/artifacts/list`
Lists artifact metadata.

## Google Gmail
- `GET /api/google/gmail/list`
- `POST /api/google/gmail/search`

## Google Drive
- `GET /api/google/drive/list`
- `POST /api/google/drive/search`
- `POST /api/google/drive/provision`
- `POST /api/google/drive/cleanup`
- `POST /api/google/disconnect`

## Selection Sets
- `GET /api/selection-sets`
- `PATCH /api/selection-sets/[id]`
- `DELETE /api/selection-sets/[id]`

## Admin
- `GET /api/admin/settings/get`
- `POST /api/admin/settings/set`

## Chat (Scaffold)
- `POST /api/chat` (answers questions from timeline sources; includes no-source guards)

## Calendar (Scaffold)
- `GET /api/calendar`
- `GET /api/calendar/entries`
