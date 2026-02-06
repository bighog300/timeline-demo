import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';

type SelectionSetFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
};

export const listSelectionSetsFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
): Promise<SelectionSetFile[]> => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name contains ' - Selection.json'`,
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
      id: file.id ?? '',
      name: file.name ?? 'Untitled Selection',
      modifiedTime: file.modifiedTime ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
    }));
};
