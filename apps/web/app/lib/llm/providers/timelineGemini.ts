import type { AdminSettings } from '../../adminSettings';
import { ProviderError, normalizeProviderHttpError } from '../providerErrors';
import { parseTimelineProviderOutput } from '../providerOutput';
import type { TimelineProvider } from './types';

const jsonOnlyInstruction =
  'Return ONLY valid JSON with keys summary and highlights (array of strings). No prose.';

const buildUserPrompt = (title: string, text: string, settings: AdminSettings) => {
  const summaryPrompt = settings.summaryPromptTemplate?.trim() || 'Create a concise summary of the source.';
  const highlightsPrompt =
    settings.highlightsPromptTemplate?.trim() || 'Extract key highlights as short bullet-friendly phrases.';

  return [
    `${summaryPrompt}`,
    `${highlightsPrompt}`,
    '',
    `Title: ${title}`,
    `Text:\n${text}`,
  ].join('\n');
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

export const geminiTimelineProvider: TimelineProvider = {
  summarize: async (input, settings) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ProviderError({
        code: 'not_configured',
        status: 500,
        provider: 'gemini',
        message: 'Provider not configured.',
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${settings.systemPrompt}\n${jsonOnlyInstruction}`.trim() }],
          },
          contents: [{ parts: [{ text: buildUserPrompt(input.title, input.text, settings) }] }],
          generationConfig: {
            temperature: settings.temperature,
            ...(settings.maxOutputTokens ? { maxOutputTokens: settings.maxOutputTokens } : {}),
          },
        }),
      },
    );

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
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';

    const parsed = parseTimelineProviderOutput(text);
    return {
      summary: parsed.summary,
      highlights: parsed.highlights,
      model: settings.model,
    };
  },
};
