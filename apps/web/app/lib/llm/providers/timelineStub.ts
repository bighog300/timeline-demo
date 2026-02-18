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
};
