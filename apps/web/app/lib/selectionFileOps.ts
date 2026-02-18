import type { drive_v3 } from 'googleapis';
import { DriveTimelineIndexJsonSchema, type DriveTimelineIndexJson } from '@timeline/shared';

import { jsonError } from './apiErrors';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';

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

export const isOwnedByFolder = (parents: string[] | null | undefined, folderId: string) =>
  Array.isArray(parents) && parents.includes(folderId);

export const updateSelectionFile = async (
  drive: drive_v3.Drive,
  fileId: string,
  name: string,
  payload: string,
) =>
  withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.update(
          {
            fileId,
            requestBody: { name },
            media: {
              mimeType: 'application/json',
              body: payload,
            },
            fields: 'id, name, webViewLink, modifiedTime',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

export const deleteDriveFile = async (drive: drive_v3.Drive, fileId: string) =>
  withRetry((signal) =>
    withTimeout(
      (timeoutSignal) => drive.files.delete({ fileId }, { signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

export const findTimelineIndexFile = async (drive: drive_v3.Drive, folderId: string) => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name='timeline-index.json'`,
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

  return response.data.files?.[0]?.id ?? null;
};

export const readTimelineIndexJson = async (
  drive: drive_v3.Drive,
  fileId: string,
): Promise<DriveTimelineIndexJson | null> => {
  const response = await withRetry((signal) =>
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
  );

  const parsed = DriveTimelineIndexJsonSchema.safeParse(parseDriveJson(response.data));
  return parsed.success ? parsed.data : null;
};

export const writeTimelineIndexJson = async (
  drive: drive_v3.Drive,
  fileId: string,
  index: DriveTimelineIndexJson,
) =>
  withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.update(
          {
            fileId,
            media: {
              mimeType: 'application/json',
              body: JSON.stringify(index, null, 2),
            },
            fields: 'id',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

export const internalError = (message: string) => jsonError(500, 'internal_error', message);
