# Timeline — Product Requirements Document (PRD)

## 1. Product Summary
Timeline is a privacy-first document summarisation and indexing app for Google Gmail and Google Drive, centered around a timeline-style interface.

Core promise:
1. User selects specific Gmail/Drive items.
2. App generates summaries.
3. Outputs are written back to a user-owned Drive folder.
4. User can search, organise, and explore results in timeline views.

## 2. Target User
- Knowledge workers
- Founders / operators
- Researchers
- Legal / compliance reviewers
- Anyone needing structured summaries of selected Google content

## 3. Core Principles
- No background scanning
- Explicit user selection only
- Drive folder is canonical storage
- Database is cache/index only (optional)
- Transparent + trust-forward UX

## 4. MVP Features
### Authentication
- Google OAuth (openid, email, profile, Gmail, Drive scopes)

### Selection
- Select Gmail messages
- Select Drive files
- Save selection sets

### Summarisation
- Deterministic stub summarizer (current)
- Future: OpenAI/Gemini provider abstraction
- Artifacts written to Drive

### Timeline View
- List summaries chronologically
- Filter/search artifacts
- Open source links

### Indexing
- Metadata-only index file in Drive
- Fast artifact listing/search

## 5. Non-Goals (MVP)
- Background Gmail ingestion
- Full-text DB storage
- Enterprise SSO
- Multi-tenant role systems

## 6. Success Criteria
- OAuth connect works reliably
- Drive folder provisioning works
- Summaries written to Drive
- Index rebuild works
- Search works against Drive artifacts

## 7. Future Enhancements
- AI provider configuration in Admin
- Tag/entity extraction
- Calendar projection view
- Chat over timeline artifacts
- Improved indexing + classification
