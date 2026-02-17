import {
  TimelineIndexSchema,
  TimelineIndexSelectionSetSchema,
  TimelineIndexSummarySchema,
  type TimelineIndex,
  type TimelineIndexSelectionSet,
  type TimelineIndexSummary,
} from '@timeline/shared';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

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

const coerceTimelineIndex = (value: unknown): TimelineIndex | null => {
  if (!isRecord(value)) {
    return null;
  }

  const summaries = Array.isArray(value.summaries)
    ? value.summaries
        .map((entry) =>
          TimelineIndexSummarySchema.safeParse({
            ...entry,
            source: isRecord(entry) && entry.source === undefined ? 'drive' : isRecord(entry) ? entry.source : undefined,
            sourceId:
              isRecord(entry) && entry.sourceId === undefined && typeof entry.driveFileId === 'string'
                ? entry.driveFileId
                : isRecord(entry)
                  ? entry.sourceId
                  : undefined,
          }),
        )
        .filter((result): result is { success: true; data: TimelineIndexSummary } => result.success)
        .map((result) => normalizeSummary(result.data))
    : [];

  const selectionSets = Array.isArray(value.selectionSets)
    ? value.selectionSets
        .map((entry) => TimelineIndexSelectionSetSchema.safeParse(entry))
        .filter((result): result is { success: true; data: TimelineIndexSelectionSet } => result.success)
        .map((result) => normalizeSelectionSet(result.data))
    : [];

  const parsed = TimelineIndexSchema.safeParse({
    ...value,
    version: typeof value.version === 'number' && value.version > 0 ? value.version : 1,
    updatedAtISO: typeof value.updatedAtISO === 'string' && value.updatedAtISO.trim() ? value.updatedAtISO.trim() : new Date().toISOString(),
    driveFolderId: typeof value.driveFolderId === 'string' ? value.driveFolderId : '',
    indexFileId: typeof value.indexFileId === 'string' ? value.indexFileId : '',
    summaries,
    selectionSets,
    stats: {
      totalSummaries: summaries.length,
      totalSelectionSets: selectionSets.length,
    },
  });

  return parsed.success ? parsed.data : null;
};

export const isTimelineIndex = (value: unknown): value is TimelineIndex => {
  if (!isRecord(value)) {
    return false;
  }

  const canParseSummaries =
    value.summaries === undefined ||
    (Array.isArray(value.summaries) &&
      value.summaries.every((entry) => {
        if (!isRecord(entry)) {
          return false;
        }

        return TimelineIndexSummarySchema.safeParse({
          ...entry,
          source: entry.source ?? 'drive',
          sourceId: typeof entry.sourceId === 'string' ? entry.sourceId : entry.driveFileId,
        }).success;
      }));

  const canParseSelectionSets =
    value.selectionSets === undefined ||
    (Array.isArray(value.selectionSets) &&
      value.selectionSets.every((entry) => TimelineIndexSelectionSetSchema.safeParse(entry).success));

  return canParseSummaries && canParseSelectionSets;
};

export const normalizeTimelineIndex = (
  value: TimelineIndex,
  folderId: string,
  fileId: string,
): TimelineIndex =>
  coerceTimelineIndex({ ...value, driveFolderId: folderId, indexFileId: fileId }) ?? {
    version: 1,
    updatedAtISO: new Date().toISOString(),
    driveFolderId: folderId,
    indexFileId: fileId,
    summaries: [],
    selectionSets: [],
    stats: {
      totalSummaries: 0,
      totalSelectionSets: 0,
    },
  };
