import type { drive_v3 } from 'googleapis';
import { DriveSelectionSetJsonSchema, type DriveSelectionSetJson } from '@timeline/shared';

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

export const SELECTION_FILE_SUFFIX = ' - Selection.json';

export type SelectionFileListItem = {
  fileId: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
};

export const listSelectionFiles = async (
  drive: drive_v3.Drive,
  folderId: string,
): Promise<SelectionFileListItem[]> => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name contains '${SELECTION_FILE_SUFFIX}'`,
            orderBy: 'modifiedTime desc',
            fields: 'files(id, name, modifiedTime, webViewLink)',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return (response.data.files ?? [])
    .filter((file) => Boolean(file.id))
    .map((file) => ({
      fileId: file.id ?? '',
      name: file.name ?? 'Untitled Selection',
      modifiedTime: file.modifiedTime ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
    }));
};

export const getSelectionFileMetadata = async (drive: drive_v3.Drive, fileId: string) =>
  withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get(
          {
            fileId,
            fields: 'id, name, parents, modifiedTime, webViewLink',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

export const readDriveSelectionJson = async (
  drive: drive_v3.Drive,
  fileId: string,
): Promise<DriveSelectionSetJson | null> => {
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

  const parsed = DriveSelectionSetJsonSchema.safeParse(parseDriveJson(response.data));
  return parsed.success ? parsed.data : null;
};
