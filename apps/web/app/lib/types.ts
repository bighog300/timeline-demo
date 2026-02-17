import type {
  SelectionSet as SharedSelectionSet,
  SelectionSetItem as SharedSelectionSetItem,
  SourceMetadata as SharedSourceMetadata,
  SummaryArtifact as SharedSummaryArtifact,
} from '@timeline/shared';

export type SelectionItem = {
  source: 'gmail' | 'drive';
  id: string;
  title: string;
  dateISO?: string;
  metadata?: Record<string, unknown>;
};

export type SourceMetadata = SharedSourceMetadata;
export type SummaryArtifact = SharedSummaryArtifact;

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

export type SelectionSetItem = SharedSelectionSetItem;
export type SelectionSet = SharedSelectionSet;
