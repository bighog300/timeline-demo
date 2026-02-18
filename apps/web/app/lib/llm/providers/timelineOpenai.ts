import type { AdminSettings } from '../../adminSettings';
import type { DateExtractionInput } from '../contentDateExtraction';
import { renderTemplate } from '../promptTemplate';
import { ProviderError, normalizeProviderHttpError } from '../providerErrors';
import {
  parseDateOnlyProviderOutput,
  parseTimelineChatProviderOutput,
  parseTimelineProviderOutput,
  parseTimelineSynthesisProviderOutput,
} from '../providerOutput';
import type { TimelineProvider } from './types';

const jsonOnlyInstruction =
  'Return ONLY valid JSON with keys summary (string), highlights (string[]), evidence (array optional), dateConfidence (number 0..1 optional), and contentDateISO (string|null), and optional suggestedActions (array of {id?: string, type: "reminder"|"task"|"calendar", text: string, dueDateISO?: string|null, confidence?: number|null}). No prose.';

const dateOnlyJsonInstruction =
  'Return ONLY valid JSON: {"contentDateISO": string|null}. Use null when no primary date is present. No prose.';

const timelineChatJsonInstruction =
  'Return ONLY valid JSON: {"answer": string, "citations": [{"artifactId": string, "excerpt": string}], "usedArtifactIds": string[]}. Use only provided artifacts and do not hallucinate sources.';

const timelineSynthesisJsonInstruction =
  'Return ONLY valid JSON: {"synthesis": {"synthesisId": string, "mode": "briefing"|"status_report"|"decision_log"|"open_loops", "title": string, "createdAtISO": string|null, "content": string, "keyPoints"?: string[], "decisions"?: string[], "risks"?: string[], "openLoops"?: string[]}, "citations": [{"artifactId": string, "excerpt": string}]}. Use ONLY provided artifacts and never fabricate sources.';

const defaultSummaryPrompt = 'Create a concise summary of the source.';
const defaultHighlightsPrompt = 'Extract key highlights as short bullet-friendly phrases.';
const defaultContentDatePrompt =
  'If the content describes a specific date/time (e.g., event date), set contentDateISO to that date/time in ISO 8601. If multiple dates exist, choose the primary one. If no meaningful date, set null.';

const buildTimelineSynthesisPrompt = (
  input: {
    mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops';
    title?: string;
    includeEvidence: boolean;
    artifacts: Array<{
      artifactId: string;
      title: string;
      contentDateISO?: string;
      summary: string;
      highlights: string[];
      evidence?: Array<{ sourceId?: string; excerpt: string }>;
    }>;
  },
) =>
  [
    'Create a cross-artifact synthesis briefing using ONLY provided artifact content.',
    'Ground every claim in summaries/highlights (and evidence only when includeEvidence=true).',
    'Citations must reference exact artifactId values and short excerpts from provided content.',
    'Never invent sources or artifact ids.',
    '',
    `Mode: ${input.mode}`,
    `Requested title: ${input.title ?? ''}`,
    `Include evidence: ${input.includeEvidence ? 'yes' : 'no'}`,
    '',
    'Artifacts:',
    ...input.artifacts.map((artifact) =>
      [
        `ArtifactId: ${artifact.artifactId}`,
        `Title: ${artifact.title}`,
        `ContentDateISO: ${artifact.contentDateISO ?? 'unknown'}`,
        `Summary: ${artifact.summary}`,
        `Highlights: ${artifact.highlights.join(' | ') || '(none)'}`,
        input.includeEvidence
          ? `Evidence: ${(artifact.evidence ?? []).map((item) => item.excerpt).join(' | ') || '(none)'}`
          : 'Evidence: (excluded)',
      ].join('\n'),
    ),
  ].join('\n\n');

const buildTimelineChatPrompt = (
  query: string,
  artifacts: Array<{ artifactId: string; title: string; contentDateISO?: string; summary: string; highlights: string[] }>,
) =>
  [
    'Answer the user query using ONLY the provided artifact snippets.',
    'Citations must reference artifactId values from snippets and include short excerpts.',
    'If evidence is insufficient, say so.',
    '',
    `User query: ${query}`,
    '',
    'Artifacts:',
    ...artifacts.map((artifact) =>
      [
        `ArtifactId: ${artifact.artifactId}`,
        `Title: ${artifact.title}`,
        `ContentDateISO: ${artifact.contentDateISO ?? 'unknown'}`,
        `Summary: ${artifact.summary}`,
        `Highlights: ${artifact.highlights.join(' | ') || '(none)'}`,
      ].join('\n'),
    ),
  ].join('\n\n');

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
    'Extract 3-5 evidence snippets as evidence[].excerpt with optional sourceId.',
    'Optionally include suggestedActions grounded in explicit source details only. Keep practical and non-speculative.',
    'Set suggestedActions[].dueDateISO only when the date/time is explicitly present in source text or metadata; otherwise omit it.',
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
      evidence: parsed.evidence,
      dateConfidence: parsed.dateConfidence,
      contentDateISO: parsed.contentDateISO,
      model: settings.model,
      suggestedActions: parsed.suggestedActions,
    };
  },
  timelineChat: async (input, settings) => {
    const apiKey = getConfiguredApiKey();
    const rawText = await callResponsesApi(
      apiKey,
      settings,
      buildTimelineChatPrompt(input.query, input.artifacts),
      timelineChatJsonInstruction,
    );
    return parseTimelineChatProviderOutput(rawText);
  },
  timelineSynthesize: async (input, settings) => {
    const apiKey = getConfiguredApiKey();
    const nowISO = new Date().toISOString();
    const rawText = await callResponsesApi(
      apiKey,
      settings,
      buildTimelineSynthesisPrompt(input),
      timelineSynthesisJsonInstruction,
    );
    return parseTimelineSynthesisProviderOutput(rawText, {
      mode: input.mode,
      title: input.title?.trim() || `Timeline ${input.mode.replace('_', ' ')}`,
      nowISO,
    });
  },
};
