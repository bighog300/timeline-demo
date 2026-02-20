import type { TimelineArtifact } from './exportBuilder';

type ConflictType = 'date' | 'amount' | 'boolean_fact' | 'named_entity' | 'status_fact';
type ConflictSeverity = 'high' | 'medium' | 'low';

type ConflictArtifactEvidence = {
  artifactId: string;
  title?: string;
  contentDateISO?: string | null;
  sourceLabel?: string;
  evidenceSnippet?: string;
};

export type PotentialConflict = {
  conflictId: string;
  type: ConflictType;
  severity: ConflictSeverity;
  summary: string;
  artifacts: [ConflictArtifactEvidence, ConflictArtifactEvidence];
  details: {
    leftValue?: string;
    rightValue?: string;
    evidence?: string;
  };
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'with', 'this', 'those', 'these', 'your', 'our', 'their',
]);

const STATUS_PATTERNS: Array<{ label: string; positive: RegExp; negative: RegExp }> = [
  { label: 'paid', positive: /\bpaid\b/i, negative: /\bunpaid\b|\bnot\s+paid\b/i },
  { label: 'present', positive: /\bpresent\b/i, negative: /\babsent\b|\bnot\s+present\b/i },
  { label: 'agreed', positive: /\bagreed\b/i, negative: /\bnot\s+agreed\b|\bdisagreed\b/i },
  { label: 'signed', positive: /\bsigned\b/i, negative: /\bnot\s+signed\b|\bunsigned\b/i },
  { label: 'delivered', positive: /\bdelivered\b/i, negative: /\bnot\s+delivered\b|\bundelivered\b/i },
];

const firstSentence = (text?: string) => {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return (normalized.split(/(?<=[.!?])\s/)[0] ?? normalized).trim();
};

const normalizeText = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const toLabelTokens = (value: string) =>
  normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

const createEventLabel = (artifact: TimelineArtifact) => {
  const summarySentence = firstSentence(artifact.artifact.summary);
  const base = summarySentence || artifact.artifact.title;
  const tokens = toLabelTokens(base);
  return {
    raw: base,
    normalized: tokens.join(' '),
    tokens: new Set(tokens),
  };
};

const tokenSimilarity = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) overlap += 1;
  });
  const denominator = Math.max(left.size, right.size);
  return denominator === 0 ? 0 : overlap / denominator;
};

const sameEventLikely = (left: ReturnType<typeof createEventLabel>, right: ReturnType<typeof createEventLabel>) =>
  tokenSimilarity(left.tokens, right.tokens) >= 0.6;

const parseDate = (iso?: string) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const dateDiffDays = (leftISO?: string, rightISO?: string) => {
  const leftMs = parseDate(leftISO);
  const rightMs = parseDate(rightISO);
  if (leftMs === null || rightMs === null) return null;
  return Math.abs(leftMs - rightMs) / (1000 * 60 * 60 * 24);
};

const amountRegex = /(?:([$£€])\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s?(USD|GBP|EUR))/gi;

const parseAmount = (artifact: TimelineArtifact) => {
  const text = `${artifact.artifact.title} ${artifact.artifact.summary}`;
  const match = amountRegex.exec(text);
  amountRegex.lastIndex = 0;
  if (!match) return null;

  const symbol = match[1] ?? null;
  const symbolValue = match[2] ?? null;
  const codeValue = match[3] ?? null;
  const code = match[4]?.toUpperCase() ?? null;

  const rawNumber = symbolValue ?? codeValue;
  if (!rawNumber) return null;

  const numericValue = Number.parseFloat(rawNumber.replace(/,/g, ''));
  if (!Number.isFinite(numericValue)) return null;

  const currency = symbol === '$' ? 'USD' : symbol === '£' ? 'GBP' : symbol === '€' ? 'EUR' : code;
  return {
    currency,
    value: numericValue,
    raw: match[0],
  };
};

const statusMatch = (artifact: TimelineArtifact) => {
  const text = `${artifact.artifact.title} ${artifact.artifact.summary}`;
  for (const candidate of STATUS_PATTERNS) {
    const positive = candidate.positive.exec(text);
    candidate.positive.lastIndex = 0;
    const negative = candidate.negative.exec(text);
    candidate.negative.lastIndex = 0;

    if (positive && !negative) {
      return { label: candidate.label, state: 'positive' as const, snippet: positive[0] };
    }
    if (negative) {
      return { label: candidate.label, state: 'negative' as const, snippet: negative[0] };
    }
  }
  return null;
};

const summarizeSource = (artifact: TimelineArtifact) => artifact.artifact.sourceMetadata?.subject ?? artifact.artifact.title;

const severityOrder: Record<ConflictSeverity, number> = { high: 3, medium: 2, low: 1 };

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const evidenceSnippet = (text: string, token: string) => {
  if (!token) return text.slice(0, 200);
  const index = text.toLowerCase().indexOf(token.toLowerCase());
  if (index === -1) return text.slice(0, 200);
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + token.length + 80);
  return text.slice(start, end).trim();
};

export const detectPotentialConflicts = (artifacts: TimelineArtifact[]): PotentialConflict[] => {
  const conflicts: PotentialConflict[] = [];
  const dedupe = new Set<string>();

  for (let leftIndex = 0; leftIndex < artifacts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < artifacts.length; rightIndex += 1) {
      const left = artifacts[leftIndex];
      const right = artifacts[rightIndex];

      const leftLabel = createEventLabel(left);
      const rightLabel = createEventLabel(right);

      if (!sameEventLikely(leftLabel, rightLabel)) {
        continue;
      }

      const leftId = left.artifact.artifactId;
      const rightId = right.artifact.artifactId;
      const pairKey = [leftId, rightId].sort().join('::');
      const labelKey = leftLabel.normalized || rightLabel.normalized;

      const dateDifference = dateDiffDays(left.artifact.contentDateISO, right.artifact.contentDateISO);
      if (dateDifference !== null && dateDifference >= 2) {
        const key = `date:${pairKey}:${labelKey}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          conflicts.push({
            conflictId: stableHash(key),
            type: 'date',
            severity: 'high',
            summary: `These records may conflict on when "${leftLabel.raw || rightLabel.raw}" occurred; review sources.`,
            artifacts: [
              {
                artifactId: leftId,
                title: left.artifact.title,
                contentDateISO: left.artifact.contentDateISO ?? null,
                sourceLabel: summarizeSource(left),
                evidenceSnippet: `contentDateISO: ${left.artifact.contentDateISO ?? 'missing'}`,
              },
              {
                artifactId: rightId,
                title: right.artifact.title,
                contentDateISO: right.artifact.contentDateISO ?? null,
                sourceLabel: summarizeSource(right),
                evidenceSnippet: `contentDateISO: ${right.artifact.contentDateISO ?? 'missing'}`,
              },
            ],
            details: {
              leftValue: left.artifact.contentDateISO,
              rightValue: right.artifact.contentDateISO,
              evidence: `Matching label: ${leftLabel.raw || rightLabel.raw}`,
            },
          });
        }
      }

      const leftAmount = parseAmount(left);
      const rightAmount = parseAmount(right);
      if (
        leftAmount &&
        rightAmount &&
        leftAmount.value !== rightAmount.value &&
        (!leftAmount.currency || !rightAmount.currency || leftAmount.currency === rightAmount.currency)
      ) {
        const key = `amount:${pairKey}:${labelKey}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          const severity: ConflictSeverity = leftAmount.currency && rightAmount.currency ? 'high' : 'medium';
          conflicts.push({
            conflictId: stableHash(key),
            type: 'amount',
            severity,
            summary: `These records appear inconsistent on the amount for "${leftLabel.raw || rightLabel.raw}"; review sources.`,
            artifacts: [
              {
                artifactId: leftId,
                title: left.artifact.title,
                contentDateISO: left.artifact.contentDateISO ?? null,
                sourceLabel: summarizeSource(left),
                evidenceSnippet: evidenceSnippet(`${left.artifact.title} ${left.artifact.summary}`, leftAmount.raw),
              },
              {
                artifactId: rightId,
                title: right.artifact.title,
                contentDateISO: right.artifact.contentDateISO ?? null,
                sourceLabel: summarizeSource(right),
                evidenceSnippet: evidenceSnippet(`${right.artifact.title} ${right.artifact.summary}`, rightAmount.raw),
              },
            ],
            details: {
              leftValue: leftAmount.raw,
              rightValue: rightAmount.raw,
              evidence: `Matching label: ${leftLabel.raw || rightLabel.raw}`,
            },
          });
        }
      }

      const leftStatus = statusMatch(left);
      const rightStatus = statusMatch(right);
      if (leftStatus && rightStatus && leftStatus.label === rightStatus.label && leftStatus.state !== rightStatus.state) {
        const key = `status:${pairKey}:${leftStatus.label}:${labelKey}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          conflicts.push({
            conflictId: stableHash(key),
            type: 'status_fact',
            severity: 'medium',
            summary: `These records may conflict on whether the item was ${leftStatus.label}; review sources.`,
            artifacts: [
              {
                artifactId: leftId,
                title: left.artifact.title,
                contentDateISO: left.artifact.contentDateISO ?? null,
                sourceLabel: summarizeSource(left),
                evidenceSnippet: evidenceSnippet(`${left.artifact.title} ${left.artifact.summary}`, leftStatus.snippet),
              },
              {
                artifactId: rightId,
                title: right.artifact.title,
                contentDateISO: right.artifact.contentDateISO ?? null,
                sourceLabel: summarizeSource(right),
                evidenceSnippet: evidenceSnippet(`${right.artifact.title} ${right.artifact.summary}`, rightStatus.snippet),
              },
            ],
            details: {
              leftValue: leftStatus.state === 'positive' ? leftStatus.label : `not ${leftStatus.label}`,
              rightValue: rightStatus.state === 'positive' ? rightStatus.label : `not ${rightStatus.label}`,
              evidence: `Matching label: ${leftLabel.raw || rightLabel.raw}`,
            },
          });
        }
      }
    }
  }

  return conflicts
    .sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity] || a.conflictId.localeCompare(b.conflictId))
    .slice(0, 20);
};
