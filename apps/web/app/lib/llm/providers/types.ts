import type { AdminSettings } from '../../adminSettings';

export type SummarizeInput = {
  title: string;
  text: string;
  sourceMetadata?: unknown;
};

export type SummarizeOutput = {
  summary: string;
  highlights: string[];
  model: string;
};

export interface TimelineProvider {
  summarize(input: SummarizeInput, settings: AdminSettings): Promise<SummarizeOutput>;
}
