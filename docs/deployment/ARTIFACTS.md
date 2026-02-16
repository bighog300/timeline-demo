# ARTIFACTS — Timeline Drive Data Model

Drive is the source of truth.

## SummaryArtifact
- id
- createdAt
- sourceType (gmail | drive)
- sourceIds
- summary
- highlights
- driveFileId
- driveWebViewLink

## SelectionSet
- id
- name
- type (gmail | drive)
- filters

## Run
- id
- type (selection_set_run | chat_run)
- metadata (no original content)

Rules:
- No full Gmail/Drive bodies persisted
- Metadata-only run records
