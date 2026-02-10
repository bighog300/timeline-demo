import type { DateRangePreset } from '../../lib/gmailQuery';
import type { GmailSelectionSet } from '../../lib/selectionSets';

export type HydratedGmailQueryControls = {
  selectedSenders: string[];
  daysBack: DateRangePreset;
  customAfter: string;
  hasAttachment: boolean;
  freeText: string;
};

const toDateInputValue = (isoValue: string | null): string => {
  if (!isoValue) {
    return '';
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
};

const toDateRangePreset = (preset: GmailSelectionSet['query']['datePreset']): DateRangePreset => {
  if (preset === '7d') {
    return '7';
  }

  if (preset === '30d') {
    return '30';
  }

  if (preset === '90d') {
    return '90';
  }

  return 'custom';
};

export const hydrateGmailQueryControls = (selectionSet: GmailSelectionSet): HydratedGmailQueryControls => ({
  selectedSenders: selectionSet.query.senders,
  daysBack: toDateRangePreset(selectionSet.query.datePreset),
  customAfter: toDateInputValue(selectionSet.query.customAfter),
  hasAttachment: selectionSet.query.hasAttachment,
  freeText: selectionSet.query.freeText,
});
