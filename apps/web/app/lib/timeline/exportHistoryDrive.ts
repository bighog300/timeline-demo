import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../googleRequest';

export const EXPORT_HISTORY_FILENAME = 'exports_index.json';

export type ExportHistorySource = {
  viewMode: 'summaries' | 'timeline';
  selectionSetId?: string;
  query?: string;
  from?: string;
};

export type ExportHistoryItem = {
  exportId: string;
  createdAtISO: string;
  format: 'pdf' | 'drive_doc';
  artifactIds: string[];
  artifactCount: number;
  source: ExportHistorySource;
  result: {
    driveDoc?: { docId: string; webViewLink: string };
    pdf?: { filename: string };
  };
};

export type ExportHistory = {
  version: 1;
  updatedAtISO: string;
  items: ExportHistoryItem[];
};

const createDefaultExportHistory = (): ExportHistory => ({
  version: 1,
  updatedAtISO: new Date().toISOString(),
  items: [],
});

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data !== 'string') {
    return data;
  }

  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

const normalizeSource = (value: unknown): ExportHistorySource => {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const viewMode = source.viewMode === 'timeline' ? 'timeline' : 'summaries';
  return {
    viewMode,
    ...(typeof source.selectionSetId === 'string' && source.selectionSetId.trim()
      ? { selectionSetId: source.selectionSetId.trim() }
      : {}),
    ...(typeof source.query === 'string' && source.query.trim() ? { query: source.query.trim() } : {}),
    ...(typeof source.from === 'string' && source.from.trim() ? { from: source.from.trim() } : {}),
  };
};

const normalizeHistoryItem = (value: unknown): ExportHistoryItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as Record<string, unknown>;
  if (typeof item.exportId !== 'string' || !item.exportId.trim()) {
    return null;
  }

  const format = item.format === 'drive_doc' ? 'drive_doc' : item.format === 'pdf' ? 'pdf' : null;
  if (!format) {
    return null;
  }

  const artifactIds = Array.from(
    new Set(
      (Array.isArray(item.artifactIds) ? item.artifactIds : [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );

  if (!artifactIds.length) {
    return null;
  }

  const resultRaw = item.result && typeof item.result === 'object' ? (item.result as Record<string, unknown>) : {};
  const driveDocRaw =
    resultRaw.driveDoc && typeof resultRaw.driveDoc === 'object'
      ? (resultRaw.driveDoc as Record<string, unknown>)
      : null;
  const pdfRaw = resultRaw.pdf && typeof resultRaw.pdf === 'object' ? (resultRaw.pdf as Record<string, unknown>) : null;

  return {
    exportId: item.exportId.trim(),
    createdAtISO: typeof item.createdAtISO === 'string' ? item.createdAtISO : new Date().toISOString(),
    format,
    artifactIds,
    artifactCount:
      typeof item.artifactCount === 'number' && Number.isFinite(item.artifactCount)
        ? Math.max(artifactIds.length, Math.floor(item.artifactCount))
        : artifactIds.length,
    source: normalizeSource(item.source),
    result: {
      ...(driveDocRaw && typeof driveDocRaw.docId === 'string' && typeof driveDocRaw.webViewLink === 'string'
        ? { driveDoc: { docId: driveDocRaw.docId, webViewLink: driveDocRaw.webViewLink } }
        : {}),
      ...(pdfRaw && typeof pdfRaw.filename === 'string' ? { pdf: { filename: pdfRaw.filename } } : {}),
    },
  };
};

const normalizeHistory = (value: unknown): ExportHistory => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((entry) => normalizeHistoryItem(entry))
    .filter((entry): entry is ExportHistoryItem => Boolean(entry));

  return {
    version: 1,
    updatedAtISO: typeof raw.updatedAtISO === 'string' ? raw.updatedAtISO : new Date().toISOString(),
    items,
  };
};

const findExportHistoryFile = async (drive: drive_v3.Drive, folderId: string) => {
  const listed = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name='${EXPORT_HISTORY_FILENAME}'`,
            pageSize: 1,
            fields: 'files(id)',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return listed.data.files?.[0]?.id ?? null;
};

const writeExportHistory = async (
  drive: drive_v3.Drive,
  folderId: string,
  existingFileId: string | null,
  history: ExportHistory,
) => {
  const payload = JSON.stringify({ ...history, version: 1, updatedAtISO: new Date().toISOString() }, null, 2);

  if (existingFileId) {
    const updated = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.update(
            {
              fileId: existingFileId,
              media: { mimeType: 'application/json', body: payload },
              fields: 'id',
            },
            { signal: timeoutSignal },
          ),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );

    return updated.data.id ?? existingFileId;
  }

  const created = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: {
              name: EXPORT_HISTORY_FILENAME,
              parents: [folderId],
              mimeType: 'application/json',
            },
            media: { mimeType: 'application/json', body: payload },
            fields: 'id',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return created.data.id ?? '';
};

export const trimExportHistory = (history: ExportHistory, maxItems = 100): ExportHistory => {
  const cap = Number.isFinite(maxItems) ? Math.max(1, Math.floor(maxItems)) : 100;
  const trimmedItems = history.items.slice(-cap);
  return {
    ...history,
    items: trimmedItems,
  };
};

export const readExportHistory = async (drive: drive_v3.Drive, folderId: string): Promise<ExportHistory> => {
  const fileId = await findExportHistoryFile(drive, folderId);
  if (!fileId) {
    const defaults = createDefaultExportHistory();
    await writeExportHistory(drive, folderId, null, defaults);
    return defaults;
  }

  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get({ fileId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return normalizeHistory(parseDriveJson(response.data));
};

export const appendExportHistoryItem = async (
  drive: drive_v3.Drive,
  folderId: string,
  item: ExportHistoryItem,
): Promise<void> => {
  const fileId = await findExportHistoryFile(drive, folderId);
  let history = createDefaultExportHistory();

  if (fileId) {
    const response = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.get({ fileId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
    history = normalizeHistory(parseDriveJson(response.data));
  }

  if (history.items.some((existing) => existing.exportId === item.exportId)) {
    return;
  }

  const normalizedItem = normalizeHistoryItem(item);
  if (!normalizedItem) {
    return;
  }

  const next = trimExportHistory({
    version: 1,
    updatedAtISO: new Date().toISOString(),
    items: [...history.items, normalizedItem],
  });

  await writeExportHistory(drive, folderId, fileId, next);
};
