import type {
  TimelineIndex,
  TimelineIndexSelectionSet,
  TimelineIndexSummary,
} from './indexTypes';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isString = (value: unknown): value is string => typeof value === 'string';

const isSummary = (value: unknown): value is TimelineIndexSummary => {
  if (!isRecord(value)) {
    return false;
  }

  const source = value.source;
  if (source !== undefined && source !== 'gmail' && source !== 'drive') {
    return false;
  }

  if (!isNonEmptyString(value.driveFileId) || !isString(value.title)) {
    return false;
  }

  if (value.sourceId !== undefined && !isNonEmptyString(value.sourceId)) {
    return false;
  }

  return (
    isOptionalString(value.createdAtISO) &&
    isOptionalString(value.updatedAtISO) &&
    isOptionalString(value.webViewLink)
  );
};

const isSelectionSet = (value: unknown): value is TimelineIndexSelectionSet => {
  if (!isRecord(value)) {
    return false;
  }

  if (!isNonEmptyString(value.driveFileId) || !isString(value.name)) {
    return false;
  }

  return isOptionalString(value.updatedAtISO) && isOptionalString(value.webViewLink);
};

export const isTimelineIndex = (value: unknown): value is TimelineIndex => {
  if (!isRecord(value)) {
    return false;
  }

  const version = value.version;
  if (version !== undefined && typeof version !== 'number') {
    return false;
  }

  if (value.updatedAtISO !== undefined && !isNonEmptyString(value.updatedAtISO)) {
    return false;
  }

  if (value.driveFolderId !== undefined && !isNonEmptyString(value.driveFolderId)) {
    return false;
  }

  if (value.indexFileId !== undefined && !isNonEmptyString(value.indexFileId)) {
    return false;
  }

  if (value.summaries !== undefined) {
    if (!Array.isArray(value.summaries) || !value.summaries.every(isSummary)) {
      return false;
    }
  }

  if (value.selectionSets !== undefined) {
    if (!Array.isArray(value.selectionSets) || !value.selectionSets.every(isSelectionSet)) {
      return false;
    }
  }

  return true;
};

const normalizeSummary = (value: TimelineIndexSummary): TimelineIndexSummary => ({
  driveFileId: value.driveFileId,
  title: value.title.trim() || 'Untitled Summary',
  source: value.source ?? 'drive',
  sourceId: value.sourceId ?? value.driveFileId,
  createdAtISO: value.createdAtISO?.trim() || undefined,
  updatedAtISO: value.updatedAtISO?.trim() || undefined,
  webViewLink: value.webViewLink?.trim() || undefined,
});

const normalizeSelectionSet = (
  value: TimelineIndexSelectionSet,
): TimelineIndexSelectionSet => ({
  driveFileId: value.driveFileId,
  name: value.name.trim() || 'Untitled Selection',
  updatedAtISO: value.updatedAtISO?.trim() || undefined,
  webViewLink: value.webViewLink?.trim() || undefined,
});

export const normalizeTimelineIndex = (
  value: TimelineIndex,
  folderId: string,
  fileId: string,
): TimelineIndex => {
  const summaries = Array.isArray(value.summaries) ? value.summaries.map(normalizeSummary) : [];
  const selectionSets = Array.isArray(value.selectionSets)
    ? value.selectionSets.map(normalizeSelectionSet)
    : [];

  return {
    version: typeof value.version === 'number' && value.version > 0 ? value.version : 1,
    updatedAtISO:
      typeof value.updatedAtISO === 'string' && value.updatedAtISO.trim()
        ? value.updatedAtISO.trim()
        : new Date().toISOString(),
    driveFolderId: folderId,
    indexFileId: fileId,
    summaries,
    selectionSets,
    stats: {
      totalSummaries: summaries.length,
      totalSelectionSets: selectionSets.length,
    },
  };
};
