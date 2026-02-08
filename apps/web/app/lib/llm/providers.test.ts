import { describe, expect, it } from 'vitest';

import { NotConfiguredError } from './errors';
import { callLLM } from './index';
import { callGemini } from './providers/gemini';
import { callOpenAI } from './providers/openai';
import type { LLMRequest } from './types';

const baseRequest: LLMRequest = {
  model: 'gpt-4o-mini',
  systemPrompt: 'Be helpful.',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.2,
};

describe('LLM providers', () => {
  it('returns stub text for stub provider', async () => {
    const response = await callLLM('stub', baseRequest);
    expect(response.text).toContain('[stub:gpt-4o-mini]');
  });

  it('throws NotConfiguredError when OpenAI key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(callOpenAI(baseRequest)).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('throws NotConfiguredError when Gemini key is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(callGemini(baseRequest)).rejects.toBeInstanceOf(NotConfiguredError);
  });
});
