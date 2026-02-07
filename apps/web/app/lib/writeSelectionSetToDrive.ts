import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { time } from './logger';
import type { SelectionSet } from './types';
import { assertPayloadWithinLimit, sanitizeDriveFileName } from './driveSafety';

type SelectionSetWriteResult = {
  driveFileId: string;
  driveWebViewLink?: string;
  modifiedTime?: string;
};

export const writeSelectionSetToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  selectionSet: SelectionSet,
  ctx?: LogContext,
): Promise<SelectionSetWriteResult> => {
  const baseName = sanitizeDriveFileName(selectionSet.name, 'Timeline Selection');
  const jsonName = `${baseName} - Selection.json`;
  const payload = JSON.stringify(selectionSet, null, 2);

  assertPayloadWithinLimit(payload, 'Selection set payload');

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
