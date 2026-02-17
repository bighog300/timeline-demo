import { summarizeDeterministic } from '../../summarize';
import type { TimelineProvider } from './types';

export const stubTimelineProvider: TimelineProvider = {
  summarize: async (input, settings) => {
    const result = summarizeDeterministic({
      title: input.title,
      text: input.text,
    });

    return {
      ...result,
      model: settings.model || 'stub',
    };
  },
};
