import { describe, expect, it } from 'vitest';

import { normalizeAdminSettings } from './adminSettings';

describe('adminSettings normalization', () => {
  it('normalizes v1 payload into v2 shape', () => {
    const normalized = normalizeAdminSettings({
      type: 'admin_settings',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      summaryPromptTemplate: 'summary template',
      highlightsPromptTemplate: 'highlights template',
      temperature: 0.4,
      maxContextItems: 12,
      maxOutputTokens: 333,
      updatedAtISO: '2025-01-01T00:00:00.000Z',
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.version).toBe(2);
    expect(normalized?.routing.default).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(normalized?.routing.tasks).toBeUndefined();
    expect(normalized?.prompts.system).toBe('system prompt');
    expect(normalized?.prompts.summarizePromptTemplate).toBe('summary template');
    expect(normalized?.prompts.highlightsPromptTemplate).toBe('highlights template');
    expect(normalized?.tasks.chat).toEqual({ temperature: 0.4, maxContextItems: 12, maxOutputTokens: 333 });
    expect(normalized?.tasks.summarize).toEqual({
      temperature: 0.4,
      maxContextItems: 12,
      maxOutputTokens: 333,
    });
    expect(normalized?.safety.mode).toBe('standard');
  });
});
