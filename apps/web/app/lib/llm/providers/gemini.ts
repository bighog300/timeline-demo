import { NotConfiguredError } from '../errors';
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
    throw new NotConfiguredError('GEMINI_API_KEY is not configured.');
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}.`);
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
