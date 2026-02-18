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
  })
  .passthrough();

const ProviderDateOnlyOutputSchema = z
  .object({
    contentDateISO: z.union([isoDateString, z.null()]).optional(),
  })
  .strict();

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

  return {
    summary,
    highlights,
    ...(evidence?.length ? { evidence } : {}),
    ...(typeof parsed.data.dateConfidence === 'number'
      ? { dateConfidence: Math.max(0, Math.min(1, parsed.data.dateConfidence)) }
      : {}),
    ...(contentDateISO ? { contentDateISO } : {}),
    ...(suggestedActions?.length ? { suggestedActions } : {}),
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
