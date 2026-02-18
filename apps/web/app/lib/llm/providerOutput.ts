import { isoDateString } from '@timeline/shared';
import { z } from 'zod';

import { ProviderError } from './providerErrors';

const ProviderOutputSchema = z
  .object({
    summary: z.string(),
    highlights: z.array(z.string()).default([]),
    contentDateISO: z.union([isoDateString, z.null()]).optional(),
  })
  .passthrough();

const ProviderDateOnlyOutputSchema = z
  .object({
    contentDateISO: z.union([isoDateString, z.null()]).optional(),
  })
  .strict();

type ParsedOutput = {
  summary: string;
  highlights: string[];
  contentDateISO?: string;
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
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response format was invalid.',
    });
  }

  const summary = parsed.data.summary.trim();
  const highlights = parsed.data.highlights.map((value) => value.trim()).filter(Boolean);
  const contentDateISO = parsed.data.contentDateISO?.trim();

  if (!summary) {
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response format was invalid.',
    });
  }

  return {
    summary,
    highlights,
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
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response format was invalid.',
    });
  }

  const contentDateISO = parsed.data.contentDateISO?.trim();
  return contentDateISO ? { contentDateISO } : {};
};
