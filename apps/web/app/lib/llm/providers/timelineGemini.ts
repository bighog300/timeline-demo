import type { AdminSettings } from '../../adminSettings';
import type { DateExtractionInput } from '../contentDateExtraction';
import { renderTemplate } from '../promptTemplate';
import { ProviderError, normalizeProviderHttpError } from '../providerErrors';
import { parseDateOnlyProviderOutput, parseTimelineProviderOutput } from '../providerOutput';
import type { TimelineProvider } from './types';

const jsonOnlyInstruction =
  'Return ONLY valid JSON with keys summary (string), highlights (string[]), and contentDateISO (string|null). No prose.';

const dateOnlyJsonInstruction =
  'Return ONLY valid JSON: {"contentDateISO": string|null}. Use null when no primary date is present. No prose.';

const defaultSummaryPrompt = 'Create a concise summary of the source.';
const defaultHighlightsPrompt = 'Extract key highlights as short bullet-friendly phrases.';
const defaultContentDatePrompt =
  'If the content describes a specific date/time (e.g., event date), set contentDateISO to that date/time in ISO 8601. If multiple dates exist, choose the primary one. If no meaningful date, set null.';

const buildUserPrompt = (
  title: string,
  text: string,
  source: string,
  metadata: string,
  settings: AdminSettings,
) => {
  const summaryPrompt = settings.summaryPromptTemplate?.trim()
    ? renderTemplate(settings.summaryPromptTemplate, { title, text, source, metadata })
    : `${settings.systemPrompt}\n${defaultSummaryPrompt}`.trim();
  const highlightsPrompt = settings.highlightsPromptTemplate?.trim()
    ? renderTemplate(settings.highlightsPromptTemplate, { title, text, source, metadata })
    : `${settings.systemPrompt}\n${defaultHighlightsPrompt}`.trim();

  return [
    `${summaryPrompt}`,
    `${highlightsPrompt}`,
    `${defaultContentDatePrompt}`,
    '',
    `Title: ${title}`,
    `Source: ${source}`,
    `Metadata:\n${metadata}`,
    `Text:\n${text}`,
  ].join('\n');
};

const buildDateOnlyPrompt = (input: DateExtractionInput) => {
  const source = input.source ?? '';
  const metadata = input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : '{}';
  const highlights = input.highlights.length > 0 ? input.highlights.map((h) => `- ${h}`).join('\n') : '- (none)';
  return [
    'Identify the primary date described by this summarized content.',
    'Prefer explicit event/content date over ingestion/update timestamps.',
    'If multiple dates exist, choose the central one. If no meaningful date is present, return null.',
    '',
    `Title: ${input.title}`,
    `Source: ${source}`,
    `Metadata:\n${metadata}`,
    `Summary:\n${input.summary}`,
    `Highlights:\n${highlights}`,
  ].join('\n');
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

const callGemini = async (
  settings: AdminSettings,
  userPrompt: string,
  instruction: string,
): Promise<string> => {
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
          parts: [{ text: `${settings.systemPrompt}\n${instruction}`.trim() }],
        },
        contents: [{ parts: [{ text: userPrompt }] }],
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
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
};

export const extractContentDateWithGemini = async (
  input: DateExtractionInput,
  settings: AdminSettings,
): Promise<{ contentDateISO?: string }> => {
  const rawText = await callGemini(settings, buildDateOnlyPrompt(input), dateOnlyJsonInstruction);
  return parseDateOnlyProviderOutput(rawText);
};

export const geminiTimelineProvider: TimelineProvider = {
  summarize: async (input, settings) => {
    const source = input.source ?? '';
    const metadata = input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : '';

    const text = await callGemini(
      settings,
      buildUserPrompt(input.title, input.text, source, metadata, settings),
      jsonOnlyInstruction,
    );

    const parsed = parseTimelineProviderOutput(text);
    return {
      summary: parsed.summary,
      highlights: parsed.highlights,
      contentDateISO: parsed.contentDateISO,
      model: settings.model,
    };
  },
};
