export type SelectionItem = {
  source: 'gmail' | 'drive';
  id: string;
  title: string;
  dateISO?: string;
  metadata?: Record<string, unknown>;
};

export type SourceMetadata = {
  from?: string;
  to?: string;
  subject?: string;
  dateISO?: string;
  threadId?: string;
  labels?: string[];
  mimeType?: string;
  driveName?: string;
  driveModifiedTime?: string;
  driveWebViewLink?: string;
};

export type SummaryArtifact = {
  artifactId: string;
  source: 'gmail' | 'drive';
  sourceId: string;
  title: string;
  createdAtISO: string;
  summary: string;
  highlights: string[];
  sourceMetadata?: SourceMetadata;
  sourcePreview?: string;
  driveFolderId: string;
  driveFileId: string;
  driveWebViewLink?: string;
  model: string;
  version: number;
};

export type CalendarEntryLinkKind = 'summary' | 'drive_file' | 'gmail_message';

export type CalendarEntryLink = {
  kind: CalendarEntryLinkKind;
  id: string;
  url?: string;
};

export type CalendarEntry = {
  type: 'calendar_entry';
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  tags?: string[];
  links?: CalendarEntryLink[];
  source: 'user' | 'derived';
  createdAtISO: string;
  updatedAtISO: string;
};

export type SelectionSetItem = {
  source: 'gmail' | 'drive';
  id: string;
  title?: string;
  dateISO?: string;
};

export type SelectionSet = {
  id: string;
  name: string;
  createdAtISO: string;
  updatedAtISO: string;
  items: SelectionSetItem[];
  notes?: string;
  version: number;
  driveFolderId: string;
  driveFileId: string;
  driveWebViewLink?: string;
};
