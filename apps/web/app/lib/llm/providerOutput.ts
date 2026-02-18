import { isoDateString } from '@timeline/shared';
import { z } from 'zod';

import { ProviderError } from './providerErrors';

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
};

const badOutput = () =>
  new ProviderError({
    code: 'bad_output',
    status: 502,
    provider: 'timeline',
    message: 'Provider response format was invalid.',
  });

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

  const citations = Array.from(
    new Map(
      parsed.data.citations
        .map((citation) => ({
          artifactId: citation.artifactId.trim(),
          excerpt: citation.excerpt.trim().slice(0, 300),
        }))
        .filter((citation) => citation.artifactId && citation.excerpt)
        .map((citation) => [`${citation.artifactId}:${citation.excerpt}`, citation]),
    ).values(),
  ).slice(0, 10);

  const usedArtifactIds = Array.from(
    new Set((parsed.data.usedArtifactIds ?? []).map((value) => value.trim()).filter(Boolean)),
  ).slice(0, 15);

  return {
    answer,
    citations,
    ...(usedArtifactIds.length ? { usedArtifactIds } : {}),
  };
};
