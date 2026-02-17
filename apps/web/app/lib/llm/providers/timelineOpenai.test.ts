import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from '../providerErrors';
import { openaiTimelineProvider } from './timelineOpenai';

describe('openai timeline provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('rejects malformed provider output', async () => {
    process.env.OPENAI_API_KEY = 'test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [{ content: [{ type: 'output_text', text: 'not-json' }] }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    await expect(
      openaiTimelineProvider.summarize(
        { title: 'Title', text: 'Body text' },
        {
          type: 'admin_settings',
          version: 1,
          provider: 'openai',
          model: 'gpt-4.1-mini',
          systemPrompt: '',
          maxContextItems: 8,
          temperature: 0.2,
          updatedAtISO: '2026-01-01T00:00:00Z',
        },
      ),
    ).rejects.toMatchObject<Partial<ProviderError>>({ code: 'bad_output', status: 502 });
  });

  it('renders summary/highlights templates when provided', async () => {
    process.env.OPENAI_API_KEY = 'test';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: '{"summary":"s","highlights":["h"]}',
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await openaiTimelineProvider.summarize(
      {
        title: 'Quarterly Plan',
        text: 'Detailed body',
        source: 'drive',
        sourceMetadata: { folder: 'Ops' },
      },
      {
        type: 'admin_settings',
        version: 1,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        systemPrompt: 'System',
        summaryPromptTemplate: 'SUM {title} {source}',
        highlightsPromptTemplate: 'HILITE {metadata}',
        maxContextItems: 8,
        temperature: 0.2,
        updatedAtISO: '2026-01-01T00:00:00Z',
      },
    );

    const req = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(req.input[1].content).toContain('SUM Quarterly Plan drive');
    expect(req.input[1].content).toContain('HILITE {"folder":"Ops"}');
  });

  it('falls back to system prompt with default instructions when templates are empty', async () => {
    process.env.OPENAI_API_KEY = 'test';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: '{"summary":"s","highlights":["h"]}',
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await openaiTimelineProvider.summarize(
      { title: 'T', text: 'Body', source: 'gmail' },
      {
        type: 'admin_settings',
        version: 1,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        systemPrompt: 'System baseline',
        summaryPromptTemplate: '   ',
        highlightsPromptTemplate: '',
        maxContextItems: 8,
        temperature: 0.2,
        updatedAtISO: '2026-01-01T00:00:00Z',
      },
    );

    const req = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(req.input[1].content).toContain('System baseline\nCreate a concise summary of the source.');
    expect(req.input[1].content).toContain(
      'System baseline\nExtract key highlights as short bullet-friendly phrases.',
    );
  });
});
