import { describe, expect, it } from 'vitest';

import { ProviderError } from './providerErrors';
import { parseTimelineChatProviderOutput, parseTimelineProviderOutput } from './providerOutput';

describe('parseTimelineProviderOutput', () => {
  it('returns normalized summary/highlights/contentDateISO when valid', () => {
    const parsed = parseTimelineProviderOutput(
      JSON.stringify({
        summary: '  Summary text  ',
        highlights: ['  h1  ', 'h2'],
        contentDateISO: '2026-01-02T00:00:00Z',
      }),
    );

    expect(parsed).toEqual({
      summary: 'Summary text',
      highlights: ['h1', 'h2'],
      contentDateISO: '2026-01-02T00:00:00Z',
    });
  });

  it('accepts null contentDateISO', () => {
    const parsed = parseTimelineProviderOutput(
      JSON.stringify({
        summary: 'Summary text',
        highlights: [],
        contentDateISO: null,
      }),
    );

    expect(parsed.contentDateISO).toBeUndefined();
  });

  it('throws bad_output for invalid contentDateISO', () => {
    expect(() =>
      parseTimelineProviderOutput(
        JSON.stringify({
          summary: 'Summary text',
          highlights: ['h1'],
          contentDateISO: 'not-a-date',
        }),
      ),
    ).toThrowError(ProviderError);

    try {
      parseTimelineProviderOutput(
        JSON.stringify({
          summary: 'Summary text',
          highlights: ['h1'],
          contentDateISO: 'not-a-date',
        }),
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'bad_output', status: 502 });
    }
  });
});


describe('parseTimelineChatProviderOutput', () => {
  it('normalizes and deduplicates citations', () => {
    const parsed = parseTimelineChatProviderOutput(JSON.stringify({
      answer: '  grounded answer ',
      citations: [
        { artifactId: ' a1 ', excerpt: '  Excerpt 1  ' },
        { artifactId: 'a1', excerpt: 'Excerpt 1' },
      ],
      usedArtifactIds: ['a1', ' a2 ', 'a1'],
    }));

    expect(parsed).toEqual({
      answer: 'grounded answer',
      citations: [{ artifactId: 'a1', excerpt: 'Excerpt 1' }],
      usedArtifactIds: ['a1', 'a2'],
    });
  });

  it('throws bad_output on empty answer', () => {
    expect(() =>
      parseTimelineChatProviderOutput(JSON.stringify({ answer: '   ', citations: [] })),
    ).toThrowError(ProviderError);
  });
});
