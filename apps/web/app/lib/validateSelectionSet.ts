import {
  SelectionSetItemSchema,
  SelectionSetSchema,
  type SelectionSet,
  type SelectionSetItem,
} from '@timeline/shared';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeItem = (item: SelectionSetItem): SelectionSetItem => ({
  source: item.source,
  id: item.id,
  title: item.title?.trim() || undefined,
  dateISO: item.dateISO?.trim() || undefined,
});

const hasValidItems = (value: unknown): boolean => {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return false;
  }

  return value.items.every((item) => SelectionSetItemSchema.safeParse(item).success);
};

const coerceSelectionSet = (value: unknown): SelectionSet | null => {
  if (!isRecord(value)) {
    return null;
  }

  const items = Array.isArray(value.items)
    ? value.items
        .map((item) => SelectionSetItemSchema.safeParse(item))
        .filter((result): result is { success: true; data: SelectionSetItem } => result.success)
        .map((result) => normalizeItem(result.data))
    : [];

  const parsed = SelectionSetSchema.safeParse({
    id: value.id,
    name: typeof value.name === 'string' ? value.name.trim() || 'Untitled Selection' : 'Untitled Selection',
    createdAtISO: value.createdAtISO,
    updatedAtISO: value.updatedAtISO,
    items,
    notes: typeof value.notes === 'string' ? value.notes.trim() || undefined : undefined,
    version: typeof value.version === 'number' && value.version > 0 ? value.version : 1,
    driveFolderId: typeof value.driveFolderId === 'string' ? value.driveFolderId : '',
    driveFileId: typeof value.driveFileId === 'string' ? value.driveFileId : '',
    driveWebViewLink: typeof value.driveWebViewLink === 'string' ? value.driveWebViewLink : undefined,
  });

  return parsed.success ? parsed.data : null;
};

export const isSelectionSet = (value: unknown): value is SelectionSet =>
  hasValidItems(value) && coerceSelectionSet(value) !== null;

export const normalizeSelectionSet = (set: SelectionSet): SelectionSet =>
  coerceSelectionSet(set) ?? {
    ...set,
    name: 'Untitled Selection',
    items: [],
    notes: undefined,
    version: 1,
    driveFolderId: '',
    driveFileId: '',
  };
