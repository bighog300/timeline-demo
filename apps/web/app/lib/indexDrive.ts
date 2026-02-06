import type { drive_v3 } from 'googleapis';

import type { TimelineIndex } from './indexTypes';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { time } from './logger';
import { isTimelineIndex, normalizeTimelineIndex } from './validateIndex';

const INDEX_FILENAME = 'timeline-index.json';

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
};

export const findIndexFile = async (
  drive: drive_v3.Drive,
  folderId: string,
  ctx?: LogContext,
): Promise<{ id: string; webViewLink?: string; modifiedTime?: string } | null> => {
  const listOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: `'${folderId}' in parents and trashed=false and name='${INDEX_FILENAME}'`,
                pageSize: 1,
                fields: 'files(id, name, modifiedTime, webViewLink)',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const response = ctx ? await time(ctx, 'drive.files.list.index', listOperation) : await listOperation();

  const file = response.data.files?.[0];
  if (!file?.id) {
    return null;
  }

  return {
    id: file.id,
    webViewLink: file.webViewLink ?? undefined,
    modifiedTime: file.modifiedTime ?? undefined,
  };
};

export const readIndexFile = async (
  drive: drive_v3.Drive,
  fileId: string,
  folderId?: string,
  ctx?: LogContext,
): Promise<TimelineIndex | null> => {
  const readOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.get(
              { fileId, alt: 'media' },
              { responseType: 'json', signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const response = ctx
    ? await time(ctx, 'drive.files.get.index', readOperation)
    : await readOperation();

  const parsed = parseDriveJson(response.data);
  if (!isTimelineIndex(parsed)) {
    return null;
  }

  const index = parsed as TimelineIndex;
  if (!folderId) {
    return index;
  }

  return normalizeTimelineIndex(index, folderId, fileId);
};

export const writeIndexFile = async (
  drive: drive_v3.Drive,
  folderId: string,
  existingFileId: string | null,
  indexObj: TimelineIndex,
  ctx?: LogContext,
): Promise<{ fileId: string; webViewLink?: string; modifiedTime?: string }> => {
  const payload = {
    ...indexObj,
    driveFolderId: folderId,
    indexFileId: existingFileId ?? indexObj.indexFileId,
  };

  if (existingFileId) {
    const updateOperation = () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.update(
                {
                  fileId: existingFileId,
                  media: {
                    mimeType: 'application/json',
                    body: JSON.stringify(payload, null, 2),
                  },
                  fields: 'id, modifiedTime, webViewLink',
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      );
    const response = ctx
      ? await time(ctx, 'drive.files.update.index', updateOperation)
      : await updateOperation();

    return {
      fileId: response.data.id ?? existingFileId,
      webViewLink: response.data.webViewLink ?? undefined,
      modifiedTime: response.data.modifiedTime ?? undefined,
    };
  }

  const createOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.create(
              {
                requestBody: {
                  name: INDEX_FILENAME,
                  parents: [folderId],
                  mimeType: 'application/json',
                },
                media: {
                  mimeType: 'application/json',
                  body: JSON.stringify(payload, null, 2),
                },
                fields: 'id, modifiedTime, webViewLink',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const createResponse = ctx
    ? await time(ctx, 'drive.files.create.index', createOperation)
    : await createOperation();

  const newFileId = createResponse.data.id ?? '';
  if (newFileId && newFileId !== payload.indexFileId) {
    const finalizeOperation = () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.update(
                {
                  fileId: newFileId,
                  media: {
                    mimeType: 'application/json',
                    body: JSON.stringify({ ...payload, indexFileId: newFileId }, null, 2),
                  },
                  fields: 'id',
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      );
    if (ctx) {
      await time(ctx, 'drive.files.update.index_finalize', finalizeOperation);
    } else {
      await finalizeOperation();
    }
  }

  return {
    fileId: newFileId,
    webViewLink: createResponse.data.webViewLink ?? undefined,
    modifiedTime: createResponse.data.modifiedTime ?? undefined,
  };
};
