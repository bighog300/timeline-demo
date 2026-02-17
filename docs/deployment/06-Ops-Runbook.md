# Timeline — Operations Runbook

## 1. Common Issues

### OAuth Callback Error
- Ensure NextAuth is in Pages Router
- Check redirect URIs

### Drive Folder Missing
- Re-run `/api/google/drive/provision`

### Summaries Not Writing
- Check access token
- Check Drive API quotas
- Verify file size limits

### Index Outdated
- `POST /api/timeline/index`

## 2. Rate Limiting
- Applied on summarization endpoints
- Returns `error_code: rate_limited`

## 3. Logging
- Request ID per request
- No document body logging

## 4. Recovery
- Rebuild index from Drive
- Sync artifacts from Drive
- Disconnect + reconnect Google

## 5. Manual Verification Flow
1. Login
2. Provision folder
3. Select Gmail item
4. Summarize
5. Confirm artifact exists in Drive
6. Search artifact
