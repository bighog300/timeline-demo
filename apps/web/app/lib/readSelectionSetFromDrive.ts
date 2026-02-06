import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { SelectionSet } from './types';
import { isSelectionSet, normalizeSelectionSet } from './validateSelectionSet';

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

export const readSelectionSetFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  fileId: string,
): Promise<SelectionSet | null> => {
  const metadata = await withRetry((signal) =>
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

  const parents = metadata.data.parents ?? [];
  if (!parents.includes(folderId)) {
    return null;
  }

  const contentResponse = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get({ fileId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );
  const parsed = parseDriveJson(contentResponse.data);

  if (!isSelectionSet(parsed)) {
    return null;
  }

  const normalized = normalizeSelectionSet(parsed);

  return {
    ...normalized,
    driveFileId: fileId,
    driveFolderId: folderId,
    driveWebViewLink: normalized.driveWebViewLink ?? metadata.data.webViewLink ?? undefined,
    updatedAtISO: metadata.data.modifiedTime ?? normalized.updatedAtISO,
  };
};
