import type { drive_v3 } from 'googleapis';

import { sanitizeDriveFileName } from './driveSafety';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { logWarn, time } from './logger';
import { createDefaultAdminSettings, normalizeAdminSettings } from './adminSettings';

const SETTINGS_FILENAME = 'AdminSettings.json';

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

export const findAdminSettingsFile = async (
  drive: drive_v3.Drive,
  folderId: string,
  ctx?: LogContext,
): Promise<{ id: string; webViewLink?: string } | null> => {
  const listOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: `'${folderId}' in parents and trashed=false and name='${SETTINGS_FILENAME}'`,
                pageSize: 1,
                fields: 'files(id, name, webViewLink)',
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
    ? await time(ctx, 'drive.files.list.admin_settings', listOperation)
    : await listOperation();

  const file = response.data.files?.[0];
  if (!file?.id) {
    return null;
  }

  return {
    id: file.id,
    webViewLink: file.webViewLink ?? undefined,
  };
};

export const readAdminSettingsFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  ctx?: LogContext,
) => {
  const file = await findAdminSettingsFile(drive, folderId, ctx);
  if (!file) {
    return {
      settings: createDefaultAdminSettings(),
      fileId: undefined,
      webViewLink: undefined,
    };
  }

  const readOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.get(
              { fileId: file.id, alt: 'media' },
              { responseType: 'json', signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const response = ctx
    ? await time(ctx, 'drive.files.get.admin_settings', readOperation)
    : await readOperation();

  const parsed = parseDriveJson(response.data);
  const normalized = normalizeAdminSettings(parsed);
  if (!normalized) {
    if (ctx) {
      logWarn(ctx, 'admin_settings_invalid', { fileId: file.id });
    }
    return {
      settings: createDefaultAdminSettings(),
      fileId: file.id,
      webViewLink: file.webViewLink ?? undefined,
    };
  }

  return {
    settings: normalized,
    fileId: file.id,
    webViewLink: file.webViewLink ?? undefined,
  };
};

export const writeAdminSettingsToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  existingFileId: string | null,
  settings: ReturnType<typeof createDefaultAdminSettings>,
  ctx?: LogContext,
): Promise<{ fileId: string; webViewLink?: string }> => {
  const payload = JSON.stringify(settings, null, 2);
  const fileName = sanitizeDriveFileName(SETTINGS_FILENAME, SETTINGS_FILENAME);

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
                    body: payload,
                  },
                  fields: 'id, webViewLink',
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
      ? await time(ctx, 'drive.files.update.admin_settings', updateOperation)
      : await updateOperation();

    return {
      fileId: response.data.id ?? existingFileId,
      webViewLink: response.data.webViewLink ?? undefined,
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
                  name: fileName,
                  parents: [folderId],
                  mimeType: 'application/json',
                },
                media: {
                  mimeType: 'application/json',
                  body: payload,
                },
                fields: 'id, webViewLink',
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
    ? await time(ctx, 'drive.files.create.admin_settings', createOperation)
    : await createOperation();

  return {
    fileId: response.data.id ?? '',
    webViewLink: response.data.webViewLink ?? undefined,
  };
};
