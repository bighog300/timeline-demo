import { NotConfiguredError } from '../errors';
import type { LLMRequest, LLMResponse } from '../types';

type OpenAIResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export const callOpenAI = async (req: LLMRequest): Promise<LLMResponse> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new NotConfiguredError('OPENAI_API_KEY is not configured.');
  }

  const messages = req.systemPrompt
    ? [{ role: 'system' as const, content: req.systemPrompt }, ...req.messages]
    : req.messages;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      messages,
      temperature: req.temperature,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as OpenAIResponse;
  const text = payload.choices?.[0]?.message?.content ?? '';
  return {
    text,
    usage: payload.usage
      ? {
          promptTokens: payload.usage.prompt_tokens,
          completionTokens: payload.usage.completion_tokens,
          totalTokens: payload.usage.total_tokens,
        }
      : undefined,
  };
};
