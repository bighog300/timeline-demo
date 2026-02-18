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
  'Return ONLY valid JSON with keys summary (string), highlights (string[]), evidence (array optional), dateConfidence (number 0..1 optional), contentDateISO (string|null), optional suggestedActions, and optional structured fields: entities[{name,type?}], decisions[{text,dateISO?,owner?,confidence?}], openLoops[{text,owner?,dueDateISO?,status?,confidence?}], risks[{text,severity?,likelihood?,owner?,mitigation?,confidence?}], participants[string[]], tags[string[]], topics[string[]]. Keep extraction grounded only in source text. No prose.';

const dateOnlyJsonInstruction =
  'Return ONLY valid JSON: {"contentDateISO": string|null}. Use null when no primary date is present. No prose.';

const timelineChatJsonInstruction =
  'Return ONLY valid JSON: {"answer": string, "citations": [{"artifactId": string, "excerpt": string}], "usedArtifactIds": string[]}. Use only provided artifacts and do not hallucinate sources.';

const timelineSynthesisJsonInstruction =
  'Return ONLY valid JSON: {"synthesis": {"synthesisId": string, "mode": "briefing"|"status_report"|"decision_log"|"open_loops", "title": string, "createdAtISO": string|null, "content": string, "keyPoints"?: string[], "entities"?: [{"name": string, "type"?: "person"|"org"|"project"|"product"|"place"|"other"}], "decisions"?: [{"text": string, "dateISO"?: string|null, "owner"?: string|null, "confidence"?: number|null}], "risks"?: [{"text": string, "severity"?: "low"|"medium"|"high", "likelihood"?: "low"|"medium"|"high", "owner"?: string|null, "mitigation"?: string|null, "confidence"?: number|null}], "openLoops"?: [{"text": string, "owner"?: string|null, "dueDateISO"?: string|null, "status"?: "open"|"closed", "confidence"?: number|null}], "participants"?: string[], "tags"?: string[], "topics"?: string[], "suggestedActions"?: [{"id"?: string, "type": "reminder"|"task"|"calendar", "text": string, "dueDateISO"?: string|null, "confidence"?: number|null}]}, "citations": [{"artifactId": string, "excerpt": string}]}. Use ONLY provided artifacts and never fabricate sources.';

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
    'Optionally include synthesis.suggestedActions only when grounded in explicit source details.',
    'Keep suggestedActions practical and non-speculative.',
    'Set dueDateISO only if explicit date/time exists in provided artifacts; otherwise omit it.',
    'Use calendar actions only when scheduling/date details are explicit in artifacts.',
    'Optionally include consolidated entities, decisions, openLoops, and risks across artifacts; dedupe and stay grounded in provided content only.',
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
    'Optionally include grounded structured extraction fields: entities, decisions, openLoops, risks, participants, tags/topics. Avoid speculation.',
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
      evidence: parsed.evidence,
      dateConfidence: parsed.dateConfidence,
      contentDateISO: parsed.contentDateISO,
      model: settings.model,
      suggestedActions: parsed.suggestedActions,
    };
  },
  timelineChat: async (input, settings) => {
    const rawText = await callGemini(
      settings,
      buildTimelineChatPrompt(input.query, input.artifacts),
      timelineChatJsonInstruction,
    );
    return parseTimelineChatProviderOutput(rawText);
  },
  timelineSynthesize: async (input, settings) => {
    const nowISO = new Date().toISOString();
    const rawText = await callGemini(
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
