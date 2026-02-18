import { describe, expect, it } from 'vitest';

import { ProviderError } from './providerErrors';
import {
  normalizeTimelineCitations,
  parseTimelineChatProviderOutput,
  parseTimelineProviderOutput,
  parseTimelineSynthesisProviderOutput,
} from './providerOutput';

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


  it('accepts valid suggestedActions output', () => {
    const parsed = parseTimelineProviderOutput(
      JSON.stringify({
        summary: 'Summary text',
        highlights: ['h1'],
        suggestedActions: [
          { type: 'reminder', text: '  Follow up with PM  ', dueDateISO: null, confidence: 0.6 },
        ],
      }),
    );

    expect(parsed.suggestedActions).toEqual([
      { type: 'reminder', text: 'Follow up with PM', dueDateISO: null, confidence: 0.6 },
    ]);
  });

  it('throws bad_output for invalid suggestedActions confidence', () => {
    expect(() =>
      parseTimelineProviderOutput(
        JSON.stringify({
          summary: 'Summary text',
          highlights: ['h1'],
          suggestedActions: [{ type: 'task', text: 'Prepare report', confidence: 5 }],
        }),
      ),
    ).toThrowError(ProviderError);

    try {
      parseTimelineProviderOutput(
        JSON.stringify({
          summary: 'Summary text',
          highlights: ['h1'],
          suggestedActions: [{ type: 'task', text: 'Prepare report', confidence: 5 }],
        }),
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'bad_output', status: 502 });
    }
  });

  it('dedupes and clamps suggestedActions to max 8', () => {
    const parsed = parseTimelineProviderOutput(
      JSON.stringify({
        summary: 'Summary text',
        highlights: [],
        suggestedActions: [
          { type: 'task', text: ' Draft recap ', dueDateISO: null },
          { type: 'task', text: 'Draft recap', dueDateISO: null },
          ...Array.from({ length: 20 }).map((_, index) => ({
            type: 'reminder',
            text: `Action ${index}`,
          })),
        ],
      }),
    );

    expect(parsed.suggestedActions).toHaveLength(8);
    expect(parsed.suggestedActions?.[0]).toMatchObject({ type: 'task', text: 'Draft recap' });
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

describe('normalizeTimelineCitations', () => {
  it('removes citations for unknown artifact ids', () => {
    const normalized = normalizeTimelineCitations(
      [
        { artifactId: 'a1', excerpt: 'one' },
        { artifactId: 'a2', excerpt: 'two' },
      ],
      { allowedArtifactIds: ['a1'] },
    );

    expect(normalized).toEqual([{ artifactId: 'a1', excerpt: 'one' }]);
  });

  it('clamps excerpt length and dedupes by normalized content', () => {
    const long = `A${'x'.repeat(500)}`;
    const normalized = normalizeTimelineCitations([
      { artifactId: 'a1', excerpt: `  ${long}\n` },
      { artifactId: 'a1', excerpt: `${long}   ` },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].excerpt.length).toBe(300);
  });

  it('caps citations to 10', () => {
    const normalized = normalizeTimelineCitations(
      Array.from({ length: 20 }).map((_, index) => ({
        artifactId: `a${index}`,
        excerpt: `excerpt-${index}`,
      })),
    );

    expect(normalized).toHaveLength(10);
  });
});


describe('parseTimelineSynthesisProviderOutput', () => {
  it('normalizes synthesis fields and citations', () => {
    const parsed = parseTimelineSynthesisProviderOutput(
      JSON.stringify({
        synthesis: {
          content: '  consolidated narrative  ',
          keyPoints: [' One ', 'One', 'Two'],
          openLoops: Array.from({ length: 40 }).map((_, i) => ({ text: ` loop ${i} `, status: 'open' })),
        },
        citations: [
          { artifactId: ' a1 ', excerpt: '  Evidence excerpt  ' },
          { artifactId: 'a1', excerpt: 'Evidence excerpt' },
        ],
      }),
      { mode: 'briefing', title: 'Fallback title', nowISO: '2026-01-01T00:00:00Z' },
    );

    expect(parsed.synthesis.content).toBe('consolidated narrative');
    expect(parsed.synthesis.mode).toBe('briefing');
    expect(parsed.synthesis.title).toBe('Fallback title');
    expect(parsed.synthesis.keyPoints).toEqual(['One', 'Two']);
    expect(parsed.synthesis.openLoops).toHaveLength(40);
    expect(parsed.citations).toEqual([{ artifactId: 'a1', excerpt: 'Evidence excerpt' }]);
  });


  it('normalizes synthesis suggestedActions with dedupe and clamp', () => {
    const parsed = parseTimelineSynthesisProviderOutput(
      JSON.stringify({
        synthesis: {
          content: 'valid content',
          suggestedActions: [
            { type: 'task', text: ' Draft recap ', dueDateISO: null },
            { type: 'task', text: 'Draft recap', dueDateISO: null },
            ...Array.from({ length: 20 }).map((_, index) => ({ type: 'reminder', text: `Action ${index}` })),
          ],
        },
        citations: [],
      }),
      { mode: 'briefing', title: 'Fallback title', nowISO: '2026-01-01T00:00:00Z' },
    );

    expect(parsed.synthesis.suggestedActions).toHaveLength(8);
    expect(parsed.synthesis.suggestedActions?.[0]).toMatchObject({ type: 'task', text: 'Draft recap' });
  });

  it('throws bad_output for invalid synthesis suggestedActions shape', () => {
    expect(() =>
      parseTimelineSynthesisProviderOutput(
        JSON.stringify({
          synthesis: {
            content: 'valid content',
            suggestedActions: [{ type: 'task', text: 'Valid text', confidence: 4 }],
          },
          citations: [],
        }),
        { mode: 'briefing', title: 'Fallback title', nowISO: '2026-01-01T00:00:00Z' },
      ),
    ).toThrowError(ProviderError);
  });

  it('throws bad_output when content is blank', () => {
    expect(() =>
      parseTimelineSynthesisProviderOutput(
        JSON.stringify({ synthesis: { content: '   ' }, citations: [] }),
        { mode: 'briefing', title: 'Title', nowISO: '2026-01-01T00:00:00Z' },
      ),
    ).toThrowError(ProviderError);
  });
});


  it('normalizes structured summarize fields with dedupe and clamp', () => {
    const parsed = parseTimelineProviderOutput(JSON.stringify({
      summary: 'Summary',
      highlights: [],
      entities: [{ name: ' Alice ', type: 'person' }, { name: 'alice', type: 'person' }],
      decisions: [{ text: ' Approve launch plan ', confidence: 0.7 }],
      openLoops: [{ text: ' Follow up with legal ', status: 'open', confidence: 0.6 }],
      risks: [{ text: ' Vendor delay risk ', severity: 'high', confidence: 0.8 }],
      participants: [' alice@example.com ', 'alice@example.com'],
    }));

    expect(parsed.entities).toEqual([{ name: 'alice', type: 'person' }]);
    expect(parsed.decisions?.[0].text).toBe('Approve launch plan');
    expect(parsed.openLoops?.[0].text).toBe('Follow up with legal');
    expect(parsed.risks?.[0].severity).toBe('high');
    expect(parsed.participants).toEqual(['alice@example.com']);
  });

  it('throws bad_output on invalid structured enums/confidence', () => {
    expect(() =>
      parseTimelineSynthesisProviderOutput(
        JSON.stringify({
          synthesis: {
            content: 'valid content',
            risks: [{ text: 'Risk', severity: 'critical' }],
          },
          citations: [],
        }),
        { mode: 'briefing', title: 'Fallback title', nowISO: '2026-01-01T00:00:00Z' },
      ),
    ).toThrowError(ProviderError);

    expect(() =>
      parseTimelineProviderOutput(
        JSON.stringify({
          summary: 'Summary text',
          highlights: ['h1'],
          decisions: [{ text: 'Decide now', confidence: 1.2 }],
        }),
      ),
    ).toThrowError(ProviderError);
  });
