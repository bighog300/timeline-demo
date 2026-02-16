# CHAT REQUIREMENTS — Timeline

This document defines the goals, constraints, and success criteria for the **Chat** feature in Timeline.

Timeline Chat is a **document-grounded assistant** over a user’s **Drive-backed SummaryArtifacts**, with privacy-first escalation to session-scoped originals when required.

---

## 1) North star

**Chat should answer like a careful analyst reading the user’s summarized documents: cite what it found, compute only from evidence, and request originals when needed.**

---

## 2) Scope and non-goals

### In scope
- Q&A over **existing SummaryArtifacts** (Drive-backed)
- Evidence-backed computations (counts, lists, aggregations)
- Timeline synthesis (themes, actor timelines, contradictions)
- Advisor framing (general informational guidance grounded in sources)
- Session-scoped opt-in originals opening when summaries are insufficient

### Out of scope
- Internet browsing or external knowledge retrieval
- Background scanning/ingestion of Gmail/Drive
- Persisting original Gmail/Drive contents
- Building a permanent full-text database of originals

---

## 3) Hard constraints (must not change)

### Privacy and storage
- **Drive is the source of truth.**
- No background scanning.
- No persistence of original content.
- Any "opened originals" tracking is **metadata-only**.

### Grounding guards
- If there are **no summaries**, return a **200 guidance response** and do **not** call an LLM provider.
- Synthesis requires **>= 2** summaries.
- Uncited extracted events must be filtered before synthesis write-up.

### Context control
- Respect `maxContextItems` and `metaBudget` logic.
- Summaries-first selection.
- No uncontrolled prompt growth.

---

## 4) Functional goals

### G1 — Grounded answers only
Chat must use SummaryArtifacts as its grounding sources.

**Success criteria**
- All substantive claims are supported by one or more citations `[1] [2] …`.
- If summaries do not contain enough evidence, chat must **not guess**.

### G2 — Intent-based routing
Chat must choose the best internal pipeline based on the question intent (not UI toggles).

Intent classes:
- **Counting / measurement**: “how many times…”, “how often…”, “number of…”, “count…”
- **Targeted lookup**: “when did…”, “what did X say…”, “who mentioned…”
- **Synthesis**: “synthesize timeline”, “themes over time”, “group events”
- **Advisor framing**: “what should I do”, “risks”, “how to respond”

**Success criteria**
- Counting questions route to the counting pipeline even if synthesis is toggled.
- Synthesis runs only when requested or clearly intended.

### G3 — Evidence-backed computations
For counting/list/aggregate questions, chat must:
1) extract discrete occurrences with citations,
2) validate + filter server-side,
3) compute totals server-side,
4) return count + occurrence list + citations.

**Success criteria**
- The model’s prose number is never trusted.
- Each occurrence row must have >= 1 in-range citation.
- Duplicate logical events are deduped server-side (when applicable).

### G4 — Privacy-preserving escalation to originals
If summaries are insufficient, chat must:
- Ask user to enable **Allow Originals** (explicit opt-in)
- Open at most N originals (capped)
- Avoid persisting original contents
- Record metadata-only audit artifact for opened originals

**Success criteria**
- The user is told why verification is needed.
- The app remains privacy-first and bounded.

### G5 — Transparent uncertainty
Chat must explicitly indicate uncertainty when evidence is incomplete.

**Success criteria**
- Uses phrases like “I can’t confirm from summaries alone” or “this may be an undercount”.
- Contradictions and missing coverage are called out.

---

## 5) Output format requirements

### Counting output (example)
- **Count found in summaries:** X
- **Occurrences:**
  1) Who — Action (When) [1]
  2) …
- **Notes** (optional)
- **Next step**: Enable Originals if exact verification is required

### Synthesis output
Use the synthesis heading template and include evidence citations on each event.
Uncited events must be omitted.

### Lookup output
- Direct answer
- Evidence citations
- List follow-up questions or suggested actions if needed

---

## 6) Operational goals

### Reliability
- Provider errors normalized into stable error codes.
- RequestId always surfaced.
- JSON parsing should be robust to wrapped/fenced outputs.

### Determinism
- Context selection and ranking should be stable and testable.
- Tie-breakers should be deterministic.

---

## 7) Testing checklist

Each change should maintain:
- `pnpm -C apps/web test`
- `pnpm -C apps/web build`
- `pnpm run vercel:build`
- `node scripts/verify-auth-routing.mjs`

Recommended test coverage:
- No summaries => guidance (no provider)
- Synthesis requires >=2 summaries
- Counting pipeline: citation-required, server-counted, deduped
- Router parsing robustness
- Intent routing precedence (counting vs synthesis)

---

## 8) Change policy

- Incremental changes only.
- Do not re-architect auth or context builder.
- Do not change artifact schema without versioning + migration plan.
- Keep privacy model intact.

