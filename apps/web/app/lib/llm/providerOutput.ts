import { ProviderError } from './providerErrors';

type ParsedOutput = {
  summary: string;
  highlights: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

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

  if (!isObject(parsedJson)) {
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response format was invalid.',
    });
  }

  const summary = typeof parsedJson.summary === 'string' ? parsedJson.summary.trim() : '';
  const highlightsRaw = Array.isArray(parsedJson.highlights) ? parsedJson.highlights : [];
  const highlights = highlightsRaw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!summary) {
    throw new ProviderError({
      code: 'bad_output',
      status: 502,
      provider: 'timeline',
      message: 'Provider response format was invalid.',
    });
  }

  return { summary, highlights };
};
