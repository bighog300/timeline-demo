export type TimelineIndexSummary = {
  driveFileId: string;
  title: string;
  source: 'gmail' | 'drive';
  sourceId: string;
  createdAtISO?: string;
  updatedAtISO?: string;
  webViewLink?: string;
};

export type TimelineIndexSelectionSet = {
  driveFileId: string;
  name: string;
  updatedAtISO?: string;
  webViewLink?: string;
};

export type TimelineIndexStats = {
  totalSummaries: number;
  totalSelectionSets: number;
};

export type TimelineIndex = {
  version: number;
  updatedAtISO: string;
  driveFolderId: string;
  indexFileId: string;
  summaries: TimelineIndexSummary[];
  selectionSets: TimelineIndexSelectionSet[];
  stats?: TimelineIndexStats;
};
