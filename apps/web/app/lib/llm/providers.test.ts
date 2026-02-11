import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callLLM } from './index';
import { ProviderError } from './providerErrors';
import { callGemini } from './providers/gemini';
import { callOpenAI } from './providers/openai';
import { callStub } from './providers/stub';
import type { LLMRequest } from './types';

const baseRequest: LLMRequest = {
  model: 'gpt-4o-mini',
  systemPrompt: 'Be helpful.',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.2,
};

describe('LLM providers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it('returns stub text for stub provider', async () => {
    const response = await callLLM('stub', baseRequest);
    expect(response.text).toContain('[stub:gpt-4o-mini]');
  });

  it('formats stub response from last user message and context count', async () => {
    const requestWithContext = {
      ...baseRequest,
      messages: [
        { role: 'user' as const, content: 'First question' },
        { role: 'assistant' as const, content: 'A reply' },
        { role: 'user' as const, content: 'Latest question' },
      ],
      context: { items: [{ id: 'a' }, { id: 'b' }] },
    };
    const response = await callStub(
      requestWithContext as LLMRequest & { context?: { items?: unknown[] } },
    );

    expect(response.text).toBe(
      "[stub:gpt-4o-mini] Received 'Latest question'. Found 2 context items.",
    );
  });

  it('returns advisor headings when system prompt requests advisor mode', async () => {
    const response = await callStub({
      ...baseRequest,
      systemPrompt: 'Use sections like ## Timeline summary and legal considerations.',
    });

    expect(response.text).toContain('## Timeline summary');
    expect(response.text).toContain('## Legal considerations (general information)');
    expect(response.text).toContain('## Psychological and interpersonal signals (non-clinical)');
  });

  it('returns synthesis headings when system prompt requests synthesis mode', async () => {
    const response = await callStub({
      ...baseRequest,
      systemPrompt: 'Use sections like ## Synthesized timeline and ## Key actors and entities.',
      messages: [{ role: 'user', content: `Context:
SOURCE 1: item
SOURCE 2: item` }],
    });

    expect(response.text).toContain('## Synthesized timeline');
    expect(response.text).toContain('## Key actors and entities');
    expect(response.text).toContain('## Contradictions and uncertainties');
    expect(response.text).toContain('Not legal advice.');
    expect(response.text).toContain('Not a diagnosis.');
  });


  it('throws ProviderError not_configured when OpenAI key is missing', async () => {
    await expect(callOpenAI(baseRequest)).rejects.toMatchObject({
      code: 'not_configured',
      status: 400,
      provider: 'openai',
    });
  });

  it('throws ProviderError not_configured when Gemini key is missing', async () => {
    await expect(callGemini(baseRequest)).rejects.toMatchObject({
      code: 'not_configured',
      status: 400,
      provider: 'gemini',
    });
  });

  it('maps OpenAI 400 invalid model to invalid_request', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'The model does not exist', code: 'model_not_found' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(callOpenAI(baseRequest)).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
      provider: 'openai',
      details: {
        providerStatus: 400,
        providerCode: 'model_not_found',
      },
    });
  });

  it('maps Gemini 401 to unauthorized', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(callGemini(baseRequest)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
      provider: 'gemini',
      details: {
        providerStatus: 401,
      },
    });
  });

  it('maps OpenAI 429 with Retry-After header to rate_limited', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '17' },
        }),
      ),
    );

    await expect(callOpenAI(baseRequest)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfterSec: 17,
      provider: 'openai',
    });
  });

  it('maps Gemini 500 to upstream_error with normalized status 502', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('internal error', { status: 500 })));

    try {
      await callGemini(baseRequest);
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({
        code: 'upstream_error',
        status: 502,
        provider: 'gemini',
        details: {
          providerStatus: 500,
        },
      });
    }
  });
});
