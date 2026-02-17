# Timeline — Data Model & Artifact Schema Specification (Strict Audit)

This spec is aligned to the **current repo implementation**.

## 1) Canonical objects
Canonical store is the app-managed Google Drive folder. DB is cache-only.

Artifacts stored in Drive:
- `<Sanitized Title> - Summary.json`
- `<Sanitized Title> - Summary.md` (optional; env controlled)
- `<Sanitized Selection Name> - Selection.json`
- `timeline-index.json`
- `AdminSettings.json`

## 2) Summary artifacts

### SummaryArtifact (API/runtime)
Key strict points:
- `artifactId` is **not** UUID; it is `${source}:${sourceId}`.
- `model` exists (currently `'stub'`); provider field does not.

Shape (conceptual):
- artifactId, source, sourceId, title, createdAtISO
- summary, highlights
- optional sourceMetadata, sourcePreview
- driveFolderId, driveFileId, optional driveWebViewLink
- model, version

### Drive Summary.json contents
The JSON written includes SummaryArtifact fields **plus** an envelope with:
- `type`, `status`, `id`, `updatedAtISO`, `meta{...}`

### Summary.md
Markdown includes title, summary, highlights, and a small metadata section.

## 3) Selection sets
Stored as a SelectionSet JSON object:
- id (uuid by default; may be set to driveFileId on update)
- name, createdAtISO, updatedAtISO
- items[] with `source`, `id`, optional `title`, optional `dateISO`
- optional notes
- version, driveFolderId, driveFileId, optional driveWebViewLink

## 4) Index
`timeline-index.json` metadata-only catalog:
- version, updatedAtISO, driveFolderId, indexFileId
- summaries[] (driveFileId, title, source, sourceId, optional created/updated, optional webViewLink)
- selectionSets[] (driveFileId, name, optional updatedAt, optional webViewLink)
- optional stats

## 5) Admin settings
`AdminSettings.json` (validated) includes:
- type: 'admin_settings'
- version: 1
- provider: stub|openai|gemini
- model, systemPrompt, maxContextItems, temperature, updatedAtISO
