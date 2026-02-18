import { isoDateString } from '@timeline/shared';
import { z } from 'zod';

import { ProviderError } from './providerErrors';

const SuggestedActionProviderSchema = z
  .object({
    id: z.string().optional(),
    type: z.enum(['reminder', 'task', 'calendar']),
    text: z.string(),
    dueDateISO: z.union([isoDateString, z.null()]).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

const StructuredEntitySchema = z
  .object({
    name: z.string(),
    type: z.enum(['person', 'org', 'project', 'product', 'place', 'other']).optional(),
  })
  .strict();

const StructuredDecisionSchema = z
  .object({
    text: z.string(),
    dateISO: z.union([isoDateString, z.null()]).optional(),
    owner: z.union([z.string(), z.null()]).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

const StructuredOpenLoopSchema = z
  .object({
    text: z.string(),
    owner: z.union([z.string(), z.null()]).optional(),
    dueDateISO: z.union([isoDateString, z.null()]).optional(),
    status: z.enum(['open', 'closed']).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

const StructuredRiskSchema = z
  .object({
    text: z.string(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
    likelihood: z.enum(['low', 'medium', 'high']).optional(),
    owner: z.union([z.string(), z.null()]).optional(),
    mitigation: z.union([z.string(), z.null()]).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

const ProviderOutputSchema = z
  .object({
    summary: z.string(),
    highlights: z.array(z.string()).default([]),
    evidence: z
      .array(
        z
          .object({
            sourceId: z.string().optional(),
            excerpt: z.string(),
          })
          .strict(),
      )
      .optional(),
    dateConfidence: z.number().min(0).max(1).optional(),
    contentDateISO: z.union([isoDateString, z.null()]).optional(),
    suggestedActions: z.array(SuggestedActionProviderSchema).optional(),
    entities: z.array(StructuredEntitySchema).optional(),
    decisions: z.array(StructuredDecisionSchema).optional(),
    openLoops: z.array(StructuredOpenLoopSchema).optional(),
    risks: z.array(StructuredRiskSchema).optional(),
    participants: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
  })
  .passthrough();

const ProviderDateOnlyOutputSchema = z
  .object({
    contentDateISO: z.union([isoDateString, z.null()]).optional(),
  })
  .strict();

const TimelineSynthesisProviderOutputSchema = z
  .object({
    synthesis: z
      .object({
        synthesisId: z.string().optional(),
        mode: z.enum(['briefing', 'status_report', 'decision_log', 'open_loops']).optional(),
        title: z.string().optional(),
        createdAtISO: z.union([isoDateString, z.null()]).optional(),
        content: z.string(),
        keyPoints: z.array(z.string()).optional(),
        decisions: z.array(StructuredDecisionSchema).optional(),
        risks: z.array(StructuredRiskSchema).optional(),
        openLoops: z.array(StructuredOpenLoopSchema).optional(),
        entities: z.array(StructuredEntitySchema).optional(),
        participants: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        topics: z.array(z.string()).optional(),
        suggestedActions: z.array(SuggestedActionProviderSchema).optional(),
      })
      .passthrough(),
    citations: z
      .array(
        z
          .object({
            artifactId: z.string(),
            excerpt: z.string(),
          })
          .strict(),
      )
      .default([]),
  })
  .passthrough();

const TimelineChatProviderOutputSchema = z
  .object({
    answer: z.string(),
    citations: z
      .array(
        z
          .object({
            artifactId: z.string(),
            excerpt: z.string(),
          })
          .strict(),
      )
      .default([]),
    usedArtifactIds: z.array(z.string()).optional(),
  })
  .passthrough();

type ParsedOutput = {
  summary: string;
  highlights: string[];
  evidence?: Array<{ sourceId?: string; excerpt: string }>;
  dateConfidence?: number;
  contentDateISO?: string;
  suggestedActions?: Array<{
    id?: string;
    type: 'reminder' | 'task' | 'calendar';
    text: string;
    dueDateISO?: string | null;
    confidence: number | null;
  }>;
  entities?: Array<{ name: string; type?: 'person' | 'org' | 'project' | 'product' | 'place' | 'other' }>;
  decisions?: Array<{ text: string; dateISO?: string | null; owner?: string | null; confidence: number | null }>;
  openLoops?: Array<{
    text: string;
    owner?: string | null;
    dueDateISO?: string | null;
    status?: 'open' | 'closed';
    confidence: number | null;
  }>;
  risks?: Array<{
    text: string;
    severity?: 'low' | 'medium' | 'high';
    likelihood?: 'low' | 'medium' | 'high';
    owner?: string | null;
    mitigation?: string | null;
    confidence: number | null;
  }>;
  participants?: string[];
  tags?: string[];
  topics?: string[];
};

const badOutput = () =>
  new ProviderError({
    code: 'bad_output',
    status: 502,
    provider: 'timeline',
    message: 'Provider response format was invalid.',
  });

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const MAX_SUGGESTED_ACTIONS = 8;
const MAX_SYNTHESIS_ITEMS = 30;
const MAX_ENTITIES = 30;
const MAX_DECISIONS = 30;
const MAX_OPEN_LOOPS = 50;
const MAX_RISKS = 30;

const normalizeOptionalText = (value: string | null | undefined, max = 120) => {
  if (typeof value !== 'string') {
    return value === null ? null : undefined;
  }
  const text = normalizeWhitespace(value).slice(0, max);
  return text || null;
};

const normalizeSuggestedActions = (actions: z.infer<typeof SuggestedActionProviderSchema>[]) =>
  Array.from(
    new Map(
      actions
        .map((action) => {
          const text = normalizeWhitespace(action.text);
          const id = action.id?.trim();
          if (!text || text.length < 3 || text.length > 240) {
            return null;
          }
          const dueDateISO = action.dueDateISO === null ? null : action.dueDateISO?.trim();
          const confidence =
            typeof action.confidence === 'number' && Number.isFinite(action.confidence)
              ? action.confidence
              : null;
          if (confidence !== null && (confidence < 0 || confidence > 1)) {
            throw badOutput();
          }

          return {
            ...(id ? { id } : {}),
            type: action.type,
            text,
            dueDateISO,
            confidence,
          };
        })
        .filter((action): action is NonNullable<typeof action> => Boolean(action))
        .map((action) => [
          `${action.type}:${action.text.toLowerCase()}:${action.dueDateISO ?? ''}`,
          action,
        ]),
    ).values(),
  ).slice(0, MAX_SUGGESTED_ACTIONS);

export const normalizeTimelineCitations = (
  citations: Array<{ artifactId: string; excerpt: string }>,
  options?: { allowedArtifactIds?: string[]; maxCitations?: number; maxExcerptChars?: number },
) => {
  const allowedArtifactIds = options?.allowedArtifactIds?.length
    ? new Set(options.allowedArtifactIds.map((value) => value.trim()).filter(Boolean))
    : null;
  const maxCitations = options?.maxCitations ?? 10;
  const maxExcerptChars = options?.maxExcerptChars ?? 300;

  return Array.from(
    new Map(
      citations
        .map((citation) => ({
          artifactId: citation.artifactId.trim(),
          excerpt: normalizeWhitespace(citation.excerpt).slice(0, maxExcerptChars),
        }))
        .filter((citation) => {
          if (!citation.artifactId || !citation.excerpt) {
            return false;
          }
          if (!allowedArtifactIds) {
            return true;
          }
          return allowedArtifactIds.has(citation.artifactId);
        })
        .map((citation) => [`${citation.artifactId}:${citation.excerpt}`, citation]),
    ).values(),
  ).slice(0, maxCitations);
};

const normalizeStringList = (values: string[] | undefined, maxItems: number) =>
  Array.from(new Set((values ?? []).map((value) => normalizeWhitespace(value)).filter(Boolean))).slice(
    0,
    maxItems,
  );

const normalizeEntities = (values: z.infer<typeof StructuredEntitySchema>[] | undefined, maxItems: number) =>
  Array.from(
    new Map(
      (values ?? [])
        .map((value) => ({
          name: normalizeWhitespace(value.name).slice(0, 80),
          type: value.type,
        }))
        .filter((value) => value.name.length > 0)
        .map((value) => [value.name.toLowerCase(), value]),
    ).values(),
  ).slice(0, maxItems);

const normalizeDecisions = (values: z.infer<typeof StructuredDecisionSchema>[] | undefined, maxItems: number) =>
  Array.from(
    new Map(
      (values ?? [])
        .map((value) => {
          const text = normalizeWhitespace(value.text).slice(0, 240);
          const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : null;
          if (confidence !== null && (confidence < 0 || confidence > 1)) {
            throw badOutput();
          }
          return {
            text,
            ...(typeof value.dateISO !== 'undefined' ? { dateISO: value.dateISO } : {}),
            ...(typeof value.owner !== 'undefined' ? { owner: normalizeOptionalText(value.owner) } : {}),
            confidence,
          };
        })
        .filter((value) => value.text.length >= 3)
        .map((value) => [value.text.toLowerCase(), value]),
    ).values(),
  ).slice(0, maxItems);

const normalizeOpenLoops = (values: z.infer<typeof StructuredOpenLoopSchema>[] | undefined, maxItems: number) =>
  Array.from(
    new Map(
      (values ?? [])
        .map((value) => {
          const text = normalizeWhitespace(value.text).slice(0, 240);
          const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : null;
          if (confidence !== null && (confidence < 0 || confidence > 1)) {
            throw badOutput();
          }
          return {
            text,
            ...(typeof value.owner !== 'undefined' ? { owner: normalizeOptionalText(value.owner) } : {}),
            ...(typeof value.dueDateISO !== 'undefined' ? { dueDateISO: value.dueDateISO } : {}),
            ...(value.status ? { status: value.status } : {}),
            confidence,
          };
        })
        .filter((value) => value.text.length >= 3)
        .map((value) => [value.text.toLowerCase(), value]),
    ).values(),
  ).slice(0, maxItems);

const normalizeRisks = (values: z.infer<typeof StructuredRiskSchema>[] | undefined, maxItems: number) =>
  Array.from(
    new Map(
      (values ?? [])
        .map((value) => {
          const text = normalizeWhitespace(value.text).slice(0, 240);
          const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : null;
          if (confidence !== null && (confidence < 0 || confidence > 1)) {
            throw badOutput();
          }
          return {
            text,
            ...(value.severity ? { severity: value.severity } : {}),
            ...(value.likelihood ? { likelihood: value.likelihood } : {}),
            ...(typeof value.owner !== 'undefined' ? { owner: normalizeOptionalText(value.owner) } : {}),
            ...(typeof value.mitigation !== 'undefined'
              ? { mitigation: normalizeOptionalText(value.mitigation, 240) }
              : {}),
            confidence,
          };
        })
        .filter((value) => value.text.length >= 3)
        .map((value) => [value.text.toLowerCase(), value]),
    ).values(),
  ).slice(0, maxItems);

export const parseTimelineProviderOutput = (rawText: string): ParsedOutput => {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response was not valid JSON.',
    });
  }

  const parsed = ProviderOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw badOutput();
  }

  const summary = parsed.data.summary.trim();
  const highlights = parsed.data.highlights.map((value) => value.trim()).filter(Boolean);
  const evidence = parsed.data.evidence
    ?.map((item) => ({
      ...(item.sourceId?.trim() ? { sourceId: item.sourceId.trim() } : {}),
      excerpt: item.excerpt.trim(),
    }))
    .filter((item) => item.excerpt)
    .slice(0, 5);
  const contentDateISO = parsed.data.contentDateISO?.trim();
  const suggestedActions = parsed.data.suggestedActions
    ? normalizeSuggestedActions(parsed.data.suggestedActions)
    : undefined;

  if (!summary) {
    throw badOutput();
  }

  const entities = normalizeEntities(parsed.data.entities, MAX_ENTITIES);
  const decisions = normalizeDecisions(parsed.data.decisions, MAX_DECISIONS);
  const openLoops = normalizeOpenLoops(parsed.data.openLoops, MAX_OPEN_LOOPS);
  const risks = normalizeRisks(parsed.data.risks, MAX_RISKS);
  const participants = normalizeStringList(parsed.data.participants, 30);
  const tags = normalizeStringList(parsed.data.tags, 20);
  const topics = normalizeStringList(parsed.data.topics, 20);

  return {
    summary,
    highlights,
    ...(evidence?.length ? { evidence } : {}),
    ...(typeof parsed.data.dateConfidence === 'number'
      ? { dateConfidence: Math.max(0, Math.min(1, parsed.data.dateConfidence)) }
      : {}),
    ...(contentDateISO ? { contentDateISO } : {}),
    ...(suggestedActions?.length ? { suggestedActions } : {}),
    ...(entities.length ? { entities } : {}),
    ...(decisions.length ? { decisions } : {}),
    ...(openLoops.length ? { openLoops } : {}),
    ...(risks.length ? { risks } : {}),
    ...(participants.length ? { participants } : {}),
    ...(tags.length ? { tags } : {}),
    ...(topics.length ? { topics } : {}),
  };
};

export const parseDateOnlyProviderOutput = (rawText: string): { contentDateISO?: string } => {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response was not valid JSON.',
    });
  }

  const parsed = ProviderDateOnlyOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw badOutput();
  }

  const contentDateISO = parsed.data.contentDateISO?.trim();
  return contentDateISO ? { contentDateISO } : {};
};

export const parseTimelineChatProviderOutput = (rawText: string) => {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response was not valid JSON.',
    });
  }

  const parsed = TimelineChatProviderOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw badOutput();
  }

  const answer = parsed.data.answer.trim();
  if (!answer) {
    throw badOutput();
  }

  const usedArtifactIds = Array.from(
    new Set((parsed.data.usedArtifactIds ?? []).map((value) => value.trim()).filter(Boolean)),
  ).slice(0, 15);

  const citations = normalizeTimelineCitations(parsed.data.citations, {
    allowedArtifactIds: usedArtifactIds.length ? usedArtifactIds : undefined,
  });

  return {
    answer,
    citations,
    ...(usedArtifactIds.length ? { usedArtifactIds } : {}),
  };
};

export const parseTimelineSynthesisProviderOutput = (
  rawText: string,
  options: { mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops'; title: string; nowISO: string },
) => {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response was not valid JSON.',
    });
  }

  const parsed = TimelineSynthesisProviderOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw badOutput();
  }

  const content = normalizeWhitespace(parsed.data.synthesis.content);
  if (!content) {
    throw badOutput();
  }

  const synthesisId = normalizeWhitespace(parsed.data.synthesis.synthesisId ?? '') || 'synthesis';
  const mode = parsed.data.synthesis.mode ?? options.mode;
  const title = normalizeWhitespace(parsed.data.synthesis.title ?? '') || options.title;
  const createdAtISO = parsed.data.synthesis.createdAtISO?.trim() || options.nowISO;
  const entities = normalizeEntities(parsed.data.synthesis.entities, MAX_ENTITIES);
  const decisions = normalizeDecisions(parsed.data.synthesis.decisions, MAX_DECISIONS);
  const risks = normalizeRisks(parsed.data.synthesis.risks, MAX_RISKS);
  const openLoops = normalizeOpenLoops(parsed.data.synthesis.openLoops, MAX_OPEN_LOOPS);

  return {
    synthesis: {
      synthesisId,
      mode,
      title,
      createdAtISO,
      content,
      ...(normalizeStringList(parsed.data.synthesis.keyPoints, 20).length
        ? { keyPoints: normalizeStringList(parsed.data.synthesis.keyPoints, 20) }
        : {}),
      ...(entities.length ? { entities } : {}),
      ...(decisions.length ? { decisions } : {}),
      ...(risks.length ? { risks } : {}),
      ...(openLoops.length ? { openLoops } : {}),
      ...(normalizeStringList(parsed.data.synthesis.participants, 30).length
        ? { participants: normalizeStringList(parsed.data.synthesis.participants, 30) }
        : {}),
      ...(normalizeStringList(parsed.data.synthesis.tags, 20).length
        ? { tags: normalizeStringList(parsed.data.synthesis.tags, 20) }
        : {}),
      ...(normalizeStringList(parsed.data.synthesis.topics, 20).length
        ? { topics: normalizeStringList(parsed.data.synthesis.topics, 20) }
        : {}),
      ...(parsed.data.synthesis.suggestedActions
        ? { suggestedActions: normalizeSuggestedActions(parsed.data.synthesis.suggestedActions) }
        : {}),
    },
    citations: normalizeTimelineCitations(parsed.data.citations, {
      maxCitations: 15,
      maxExcerptChars: 300,
    }),
  };
};
