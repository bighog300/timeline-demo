export type SelectionItem = {
  source: 'gmail' | 'drive';
  id: string;
  title: string;
  dateISO?: string;
  metadata?: Record<string, unknown>;
};

export type SummaryArtifact = {
  artifactId: string;
  source: 'gmail' | 'drive';
  sourceId: string;
  title: string;
  createdAtISO: string;
  summary: string;
  highlights: string[];
  driveFolderId: string;
  driveFileId: string;
  driveWebViewLink?: string;
  model: string;
  version: number;
};
