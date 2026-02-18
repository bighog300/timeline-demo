import type { AdminSettings } from '../adminSettings';
import { extractContentDateWithGemini } from './providers/timelineGemini';
import { extractContentDateWithOpenAi } from './providers/timelineOpenai';
import { extractContentDateWithStub } from './providers/timelineStub';

export type DateExtractionInput = {
  title: string;
  summary: string;
  highlights: string[];
  source?: string;
  sourceMetadata?: unknown;
};

export const extractContentDate = async (input: DateExtractionInput, settings: AdminSettings) => {
  switch (settings.provider) {
    case 'stub':
      return extractContentDateWithStub(input);
    case 'openai':
      return extractContentDateWithOpenAi(input, settings);
    case 'gemini':
      return extractContentDateWithGemini(input, settings);
    default: {
      const exhaustive: never = settings.provider;
      return exhaustive;
    }
  }
};
