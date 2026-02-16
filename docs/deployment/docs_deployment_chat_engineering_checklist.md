# CHAT ENGINEERING CHECKLIST — Timeline

This one-page checklist maps Chat requirements to concrete code areas and invariants. Use this before merging any Chat-related change.

---

## 1) Routing & Intent Safety

### Files
- `apps/web/app/api/chat/route.ts`

### Checklist
- [ ] Counting intent detected via deterministic regex (`isCountingQuestion`).
- [ ] Counting overrides synthesis when appropriate.
- [ ] Synthesis mode only runs when explicitly intended.
- [ ] No summaries → 200 guidance response (NO provider call).
- [ ] Synthesis requires >= 2 summaries.

---

## 2) Context Construction

### Files
- `apps/web/app/lib/chatContext.ts`

### Checklist
- [ ] Summaries-first selection preserved.
- [ ] `maxContextItems` respected.
- [ ] `metaBudget` logic unchanged.
- [ ] Recency/diversity ranking does NOT increase context size.
- [ ] Selection deterministic (stable ordering + tie-breakers).

---

## 3) Counting Pipeline Integrity

### Files
- `apps/web/app/api/chat/route.ts`

### Checklist
- [ ] JSON-only extraction instruction used for counting mode.
- [ ] Robust JSON parsing (`extractJsonObjectFromText`).
- [ ] Occurrence shape validated.
- [ ] Citations filtered to [1..summaryCount].
- [ ] Uncited occurrences dropped.
- [ ] Server computes final count (never trusts model prose).
- [ ] Logical duplicates deduped server-side.
- [ ] Citation lists merged + deduped when collapsing duplicates.
- [ ] If no grounded occurrences → uncertainty + suggest Originals.

---

## 4) Synthesis Integrity

### Files
- `apps/web/app/api/chat/route.ts`

### Checklist
- [ ] Strict JSON plan extraction for synthesis.
- [ ] Robust parsing with substring fallback.
- [ ] Uncited events filtered.
- [ ] Citation bounds enforced.
- [ ] Final synthesis references only valid sources.

---

## 5) Originals Escalation

### Files
- `apps/web/app/api/chat/route.ts`
- `apps/web/app/api/runs/[id]/route.ts`

### Checklist
- [ ] Originals opened only when explicitly allowed (`allowOriginals`).
- [ ] Hard cap on number of originals opened.
- [ ] Hard cap on total original text length.
- [ ] No original content persisted to Drive artifacts.
- [ ] Run artifact stores metadata only.

---

## 6) Provider & Error Handling

### Files
- `apps/web/app/lib/llm/providerErrors.ts`
- `apps/web/app/api/chat/route.ts`

### Checklist
- [ ] Provider errors normalized.
- [ ] `requestId` surfaced in responses.
- [ ] Stub fallback behavior preserved for non-admin when provider not configured.
- [ ] No raw provider errors leaked to client.

---

## 7) Privacy & Architecture Invariants

### Global Constraints
- [ ] Auth handler remains ONLY at `pages/api/auth/[...nextauth].ts`.
- [ ] No background Gmail/Drive scanning introduced.
- [ ] No artifact schema changes without versioning.
- [ ] No uncontrolled prompt growth.

---

## 8) Testing Requirements

### Commands (must pass)
- [ ] `pnpm -C apps/web test`
- [ ] `pnpm -C apps/web build`
- [ ] `pnpm run vercel:build`
- [ ] `node scripts/verify-auth-routing.mjs`

### Coverage expectations
- [ ] No summaries → guidance, no provider call.
- [ ] Synthesis requires >=2 summaries.
- [ ] Counting: citation-required, server-counted, deduped.
- [ ] Router parsing robust to wrapped JSON.
- [ ] Intent routing precedence tested.

---

## Merge Rule

If any checklist item is violated, the change must be revised before merge.

Chat changes must remain incremental and preserve the privacy-first, Drive-backed architecture.

