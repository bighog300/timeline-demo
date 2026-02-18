import { summarizeDeterministic } from '../../summarize';
import type { TimelineProvider } from './types';

export const stubTimelineProvider: TimelineProvider = {
  summarize: async (input, settings) => {
    const result = summarizeDeterministic({
      title: input.title,
      text: input.text,
    });

    const metadataDateISO =
      input.sourceMetadata && typeof input.sourceMetadata === 'object'
        ? (input.sourceMetadata as { dateISO?: unknown }).dateISO
        : undefined;

    const contentDateISO =
      typeof metadataDateISO === 'string' && !Number.isNaN(Date.parse(metadataDateISO))
        ? metadataDateISO
        : undefined;

    return {
      ...result,
      ...(contentDateISO ? { contentDateISO } : {}),
      model: settings.model || 'stub',
    };
  },
};
