import { summarizeDeterministic } from '../../summarize';
import type { TimelineProvider } from './types';

export const extractContentDateWithStub = async (
  input: { sourceMetadata?: unknown },
): Promise<{ contentDateISO?: string }> => {
  const metadataDateISO =
    input.sourceMetadata && typeof input.sourceMetadata === 'object'
      ? (input.sourceMetadata as { dateISO?: unknown }).dateISO
      : undefined;

  const contentDateISO =
    typeof metadataDateISO === 'string' && !Number.isNaN(Date.parse(metadataDateISO))
      ? metadataDateISO
      : undefined;

  return contentDateISO ? { contentDateISO } : {};
};

const buildSynthesisTitle = (mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops') =>
  `Timeline ${mode.replace('_', ' ')}`;


const buildStubSynthesisActions = (mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops') => {
  const dueDateISO = '2026-01-15T14:00:00Z';
  if (mode === 'decision_log') {
    return [
      { type: 'task' as const, text: 'Document the final decision in project notes', confidence: 0.78 },
      { type: 'calendar' as const, text: 'Schedule decision review', dueDateISO, confidence: 0.64 },
    ];
  }

  return [{ type: 'reminder' as const, text: 'Share synthesis follow-up with owners', confidence: 0.7 }];
};

const buildStubSuggestedActions = (text: string) => {
  const normalized = text.toLowerCase();
  if (!normalized.includes('follow up') && !normalized.includes('todo') && !normalized.includes('task')) {
    return [];
  }

  return [
    { type: 'reminder' as const, text: 'Follow up on the discussed item', confidence: 0.72 },
    { type: 'task' as const, text: 'Draft the requested next-step summary', confidence: 0.66 },
  ];
};

export const stubTimelineProvider: TimelineProvider = {
  summarize: async (input, settings) => {
    const result = summarizeDeterministic({
      title: input.title,
      text: input.text,
    });

    const dateResult = await extractContentDateWithStub(input);

    return {
      ...result,
      ...dateResult,
      evidence: [
        {
          excerpt: input.text.slice(0, 180).trim() || input.title,
          ...(input.source ? { sourceId: input.source } : {}),
        },
      ],
      dateConfidence: dateResult.contentDateISO ? 0.95 : 0.2,
      model: settings.model || 'stub',
      suggestedActions: buildStubSuggestedActions(input.text),
    };
  },
  timelineChat: async (input) => {
    const top = input.artifacts[0];
    if (!top) {
      return { answer: 'No matching timeline artifacts were provided.', citations: [], usedArtifactIds: [] };
    }
    return {
      answer: `Based on the provided timeline artifacts, ${top.summary}`,
      citations: [
        {
          artifactId: top.artifactId,
          excerpt: (top.highlights[0] ?? top.summary).slice(0, 220),
        },
      ],
      usedArtifactIds: [top.artifactId],
    };
  },
  timelineSynthesize: async (input) => {
    const nowISO = new Date().toISOString();
    const top = input.artifacts[0];
    const title = input.title?.trim() || buildSynthesisTitle(input.mode);
    const content = top
      ? `Synthesis (${input.mode}) across ${input.artifacts.length} artifacts. Primary thread: ${top.summary}`
      : `No artifacts were provided for ${input.mode}.`;

    return {
      synthesis: {
        synthesisId: `syn_${nowISO.slice(0, 10)}_${input.mode}`.replace(/[^a-zA-Z0-9_]/g, ''),
        mode: input.mode,
        title,
        createdAtISO: nowISO,
        content,
        keyPoints: top ? [top.highlights[0] ?? top.summary.slice(0, 120)] : [],
        suggestedActions: buildStubSynthesisActions(input.mode),
      },
      citations: top
        ? [
            {
              artifactId: top.artifactId,
              excerpt: (top.highlights[0] ?? top.summary).slice(0, 220),
            },
            {
              artifactId: '__unknown__',
              excerpt: 'This citation should be filtered by integrity checks.',
            },
          ]
        : [],
    };
  },
};
