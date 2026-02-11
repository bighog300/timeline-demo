import { normalizeProviderHttpError, ProviderError } from '../providerErrors';
import type { LLMRequest, LLMResponse } from '../types';

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

const toGeminiRole = (role: string) => (role === 'assistant' ? 'model' : 'user');

export const callGemini = async (req: LLMRequest): Promise<LLMResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError({
      code: 'not_configured',
      status: 400,
      provider: 'gemini',
      message: 'Provider not configured.',
    });
  }

  const contents = req.messages.map((message) => ({
    role: toGeminiRole(message.role),
    parts: [{ text: message.content }],
  }));

  const body = {
    contents,
    ...(req.systemPrompt
      ? { systemInstruction: { parts: [{ text: req.systemPrompt }] } }
      : {}),
    ...(req.temperature !== undefined ? { generationConfig: { temperature: req.temperature } } : {}),
  };

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProviderError({
        code: 'upstream_timeout',
        status: 504,
        provider: 'gemini',
        message: 'Provider request timed out.',
      });
    }

    throw new ProviderError({
      code: 'upstream_error',
      status: 502,
      provider: 'gemini',
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
      providerName: 'gemini',
      status: response.status,
      responseText,
      responseJson,
      headers: response.headers,
    });
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return {
    text,
    usage: payload.usageMetadata
      ? {
          promptTokens: payload.usageMetadata.promptTokenCount,
          completionTokens: payload.usageMetadata.candidatesTokenCount,
          totalTokens: payload.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
};
