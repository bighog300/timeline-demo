# API REFERENCE — Timeline

## Auth
/api/auth/[...nextauth]

## Chat
POST /api/chat

## Timeline
POST /api/timeline/summarize
POST /api/timeline/search
GET  /api/timeline/artifacts/list

## Google Gmail
GET  /api/google/gmail/list
POST /api/google/gmail/search

## Google Drive
GET  /api/google/drive/list
POST /api/google/drive/search
POST /api/google/drive/provision
POST /api/google/drive/cleanup
POST /api/google/disconnect

## Calendar
GET /api/calendar
GET /api/calendar/entries

## Selection Sets
GET    /api/selection-sets
PATCH  /api/selection-sets/[id]
DELETE /api/selection-sets/[id]

## Runs
GET   /api/runs
PATCH /api/runs/[id]

## Admin
GET  /api/admin/settings/get
POST /api/admin/settings/set
