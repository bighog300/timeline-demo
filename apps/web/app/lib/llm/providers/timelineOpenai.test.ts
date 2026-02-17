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
});
