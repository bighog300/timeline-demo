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

type OpenAIResponsesApi = {
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

type OpenAIChatApi = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

const extractResponseText = (payload: OpenAIResponsesApi): string => {
  const out = payload.output ?? [];
  for (const block of out) {
    for (const content of block.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  return '';
};

const callChatCompletionFallback = async (
  apiKey: string,
  settings: AdminSettings,
  userPrompt: string,
  systemInstruction: string,
): Promise<string> => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: `${settings.systemPrompt}\n${systemInstruction}`.trim() },
        { role: 'user', content: userPrompt },
      ],
      temperature: settings.temperature,
      ...(settings.maxOutputTokens ? { max_tokens: settings.maxOutputTokens } : {}),
    }),
  });

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

  const payload = (await response.json()) as OpenAIChatApi;
  return payload.choices?.[0]?.message?.content ?? '';
};

const callResponsesApi = async (
  apiKey: string,
  settings: AdminSettings,
  userPrompt: string,
  systemInstruction: string,
): Promise<string> => {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      input: [
        {
          role: 'system',
          content: `${settings.systemPrompt}\n${systemInstruction}`.trim(),
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: settings.temperature,
      ...(settings.maxOutputTokens ? { max_output_tokens: settings.maxOutputTokens } : {}),
    }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return callChatCompletionFallback(apiKey, settings, userPrompt, systemInstruction);
    }

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

  const payload = (await response.json()) as OpenAIResponsesApi;
  return extractResponseText(payload);
};

const getConfiguredApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError({
      code: 'not_configured',
      status: 500,
      provider: 'openai',
      message: 'Provider not configured.',
    });
  }
  return apiKey;
};

export const extractContentDateWithOpenAi = async (input: DateExtractionInput, settings: AdminSettings) => {
  const apiKey = getConfiguredApiKey();
  const rawText = await callResponsesApi(apiKey, settings, buildDateOnlyPrompt(input), dateOnlyJsonInstruction);
  return parseDateOnlyProviderOutput(rawText);
};

export const openaiTimelineProvider: TimelineProvider = {
  summarize: async (input, settings) => {
    const apiKey = getConfiguredApiKey();

    const source = input.source ?? '';
    const metadata = input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : '';
    const userPrompt = buildUserPrompt(input.title, input.text, source, metadata, settings);

    const rawText = await callResponsesApi(apiKey, settings, userPrompt, jsonOnlyInstruction);
    const parsed = parseTimelineProviderOutput(rawText);
    return {
      summary: parsed.summary,
      highlights: parsed.highlights,
      contentDateISO: parsed.contentDateISO,
      model: settings.model,
    };
  },
};
