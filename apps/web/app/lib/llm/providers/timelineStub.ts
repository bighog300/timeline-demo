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
      model: settings.model || 'stub',
    };
  },
};
