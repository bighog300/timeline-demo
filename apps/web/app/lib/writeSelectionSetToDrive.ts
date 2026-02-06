import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { time } from './logger';
import type { SelectionSet } from './types';

type SelectionSetWriteResult = {
  driveFileId: string;
  driveWebViewLink?: string;
  modifiedTime?: string;
};

const safeFileName = (value: string) => {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, '').trim();
  const truncated = sanitized.slice(0, 80);
  return truncated || 'Timeline Selection';
};

export const writeSelectionSetToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  selectionSet: SelectionSet,
  ctx?: LogContext,
): Promise<SelectionSetWriteResult> => {
  const baseName = safeFileName(selectionSet.name);
  const jsonName = `${baseName} - Selection.json`;
  const payload = JSON.stringify(selectionSet, null, 2);

  if (selectionSet.driveFileId) {
    const updateOperation = () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.update(
                {
                  fileId: selectionSet.driveFileId,
                  requestBody: {
                    name: jsonName,
                  },
                  media: {
                    mimeType: 'application/json',
                    body: payload,
                  },
                  fields: 'id, webViewLink, modifiedTime',
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      );
    const updateResponse = ctx
      ? await time(ctx, 'drive.files.update.selection_set', updateOperation)
      : await updateOperation();

    return {
      driveFileId: updateResponse.data.id ?? selectionSet.driveFileId,
      driveWebViewLink: updateResponse.data.webViewLink ?? undefined,
      modifiedTime: updateResponse.data.modifiedTime ?? undefined,
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
                  name: jsonName,
                  parents: [folderId],
                  mimeType: 'application/json',
                },
                media: {
                  mimeType: 'application/json',
                  body: payload,
                },
                fields: 'id, webViewLink, modifiedTime',
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
    ? await time(ctx, 'drive.files.create.selection_set', createOperation)
    : await createOperation();

  return {
    driveFileId: createResponse.data.id ?? '',
    driveWebViewLink: createResponse.data.webViewLink ?? undefined,
    modifiedTime: createResponse.data.modifiedTime ?? undefined,
  };
};
