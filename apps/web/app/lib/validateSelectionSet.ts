import type { SelectionSet, SelectionSetItem } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSelectionSetItem = (value: unknown): value is SelectionSetItem => {
  if (!isRecord(value)) {
    return false;
  }

  const source = value.source;
  if (source !== 'gmail' && source !== 'drive') {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.dateISO === undefined || typeof value.dateISO === 'string')
  );
};

export const isSelectionSet = (value: unknown): value is SelectionSet => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAtISO === 'string' &&
    typeof value.updatedAtISO === 'string' &&
    Array.isArray(value.items) &&
    value.items.every(isSelectionSetItem) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.version === undefined || typeof value.version === 'number') &&
    (value.driveFolderId === undefined || typeof value.driveFolderId === 'string') &&
    (value.driveFileId === undefined || typeof value.driveFileId === 'string') &&
    (value.driveWebViewLink === undefined || typeof value.driveWebViewLink === 'string')
  );
};

const normalizeItem = (item: SelectionSetItem): SelectionSetItem => ({
  source: item.source,
  id: item.id,
  title: item.title?.trim() || undefined,
  dateISO: item.dateISO?.trim() || undefined,
});

export const normalizeSelectionSet = (set: SelectionSet): SelectionSet => ({
  ...set,
  name: set.name.trim() || 'Untitled Selection',
  items: Array.isArray(set.items) ? set.items.filter(isSelectionSetItem).map(normalizeItem) : [],
  notes: set.notes?.trim() || undefined,
  version: Number.isFinite(set.version) && set.version > 0 ? set.version : 1,
  driveFolderId: set.driveFolderId || '',
  driveFileId: set.driveFileId || '',
});
