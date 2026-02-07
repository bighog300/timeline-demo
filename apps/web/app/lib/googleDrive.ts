import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';

import { sanitizeDriveFileName } from './driveSafety';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { logWarn, time } from './logger';

export const createDriveClient = (accessToken: string): drive_v3.Drive => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth });
};

type OcrPdfToTextParams = {
  drive: drive_v3.Drive;
  fileId: string;
  folderId: string;
  filename?: string;
  ocrLanguage?: string;
  keepOcrDoc?: boolean;
  ctx?: LogContext;
};

export const ocrPdfToText = async ({
  drive,
  fileId,
  folderId,
  filename,
  ocrLanguage,
  keepOcrDoc = false,
  ctx,
}: OcrPdfToTextParams): Promise<{ text: string; ocrDocId?: string }> => {
  const safeName = sanitizeDriveFileName(`OCR - ${filename ?? 'PDF'}`, 'OCR - PDF');

  const copyOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.copy(
              {
                fileId,
                requestBody: {
                  name: safeName,
                  parents: [folderId],
                  mimeType: 'application/vnd.google-apps.document',
                },
                ...(ocrLanguage ? { ocrLanguage } : {}),
                ocr: true,
              } as drive_v3.Params$Resource$Files$Copy & { ocr?: boolean; ocrLanguage?: string },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );

  const copyResponse = ctx ? await time(ctx, 'drive.files.copy.ocr', copyOperation) : await copyOperation();
  const ocrDocId = copyResponse.data.id;
  if (!ocrDocId) {
    throw new Error('OCR document creation failed.');
  }

  const exportOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.export(
              { fileId: ocrDocId, mimeType: 'text/plain' },
              { responseType: 'text', signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );

  const exportResponse = ctx
    ? await time(ctx, 'drive.files.export.ocr', exportOperation)
    : await exportOperation();
  const text = typeof exportResponse.data === 'string' ? exportResponse.data : '';

  if (!keepOcrDoc) {
    try {
      const deleteOperation = () =>
        withRetry(
          (signal) =>
            withTimeout(
              (timeoutSignal) =>
                drive.files.delete({ fileId: ocrDocId }, { signal: timeoutSignal }),
              DEFAULT_GOOGLE_TIMEOUT_MS,
              'upstream_timeout',
              signal,
            ),
          { ctx },
        );
      if (ctx) {
        await time(ctx, 'drive.files.delete.ocr', deleteOperation);
      } else {
        await deleteOperation();
      }
    } catch (error) {
      if (ctx) {
        logWarn(ctx, 'drive.ocr_cleanup_failed', {
          fileId: ocrDocId,
          error: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }
    return { text };
  }

  return { text, ocrDocId };
};
