import type { AdminSettings } from '../../adminSettings';

export type SummarizeInput = {
  title: string;
  text: string;
  source?: string;
  sourceMetadata?: unknown;
};

export type SuggestedActionOutput = {
  id?: string;
  type: 'reminder' | 'task' | 'calendar';
  text: string;
  dueDateISO?: string | null;
  confidence?: number | null;
};

export type SummarizeOutput = {
  summary: string;
  highlights: string[];
  evidence?: Array<{ sourceId?: string; excerpt: string }>;
  dateConfidence?: number;
  contentDateISO?: string;
  model: string;
  suggestedActions?: SuggestedActionOutput[];
};

export type TimelineChatCitation = {
  artifactId: string;
  excerpt: string;
};

export type TimelineChatInputArtifact = {
  artifactId: string;
  title: string;
  contentDateISO?: string;
  summary: string;
  highlights: string[];
};

export type TimelineChatInput = {
  query: string;
  artifacts: TimelineChatInputArtifact[];
};

export type TimelineChatOutput = {
  answer: string;
  citations: TimelineChatCitation[];
  usedArtifactIds?: string[];
};



export type TimelineSynthesisCitation = {
  artifactId: string;
  excerpt: string;
};

export type TimelineSynthesisInputArtifact = {
  artifactId: string;
  title: string;
  contentDateISO?: string;
  summary: string;
  highlights: string[];
  evidence?: Array<{ sourceId?: string; excerpt: string }>;
};

export type TimelineSynthesizeInput = {
  mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops';
  title?: string;
  includeEvidence: boolean;
  artifacts: TimelineSynthesisInputArtifact[];
};

export type TimelineSynthesizeOutput = {
  synthesis: {
    synthesisId: string;
    mode: 'briefing' | 'status_report' | 'decision_log' | 'open_loops';
    title: string;
    createdAtISO: string;
    content: string;
    keyPoints?: string[];
    decisions?: string[];
    risks?: string[];
    openLoops?: string[];
  };
  citations: TimelineSynthesisCitation[];
};

export interface TimelineProvider {
  summarize(input: SummarizeInput, settings: AdminSettings): Promise<SummarizeOutput>;
  timelineChat(input: TimelineChatInput, settings: AdminSettings): Promise<TimelineChatOutput>;
  timelineSynthesize(input: TimelineSynthesizeInput, settings: AdminSettings): Promise<TimelineSynthesizeOutput>;
}
