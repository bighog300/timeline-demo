import { normalizeProviderHttpError, ProviderError } from '../providerErrors';
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
    throw new ProviderError({
      code: 'not_configured',
      status: 400,
      provider: 'openai',
      message: 'Provider not configured.',
    });
  }

  const messages = req.systemPrompt
    ? [{ role: 'system' as const, content: req.systemPrompt }, ...req.messages]
    : req.messages;

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
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
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProviderError({
        code: 'upstream_timeout',
        status: 504,
        provider: 'openai',
        message: 'Provider request timed out.',
      });
    }

    throw new ProviderError({
      code: 'upstream_error',
      status: 502,
      provider: 'openai',
      message: 'Provider request failed.',
    });
  }

  if (!response.ok) {
    let responseJson: unknown;
    let responseText: string | undefined;

    try {
      responseJson = await response.json();
    } catch {
      responseText = await response.text().catch(() => undefined);
    }

    throw normalizeProviderHttpError({
      providerName: 'openai',
      status: response.status,
      responseText,
      responseJson,
      headers: response.headers,
    });
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
