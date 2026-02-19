import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../googleRequest';
import { SCHEDULE_CONFIG_FILENAME, createDefaultScheduleConfig, normalizeScheduleConfig } from './scheduleConfig';

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

export const findScheduleConfigFile = async (drive: drive_v3.Drive, folderId: string) => {
  const listed = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name='${SCHEDULE_CONFIG_FILENAME}'`,
            pageSize: 1,
            fields: 'files(id, webViewLink)',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const file = listed.data.files?.[0];
  return file?.id ? { id: file.id, webViewLink: file.webViewLink ?? undefined } : null;
};

export const readScheduleConfigFromDrive = async (drive: drive_v3.Drive, folderId: string) => {
  const found = await findScheduleConfigFile(drive, folderId);
  if (!found) {
    const created = await writeScheduleConfigToDrive(drive, folderId, null, createDefaultScheduleConfig());
    return { config: createDefaultScheduleConfig(), fileId: created.fileId, webViewLink: created.webViewLink };
  }

  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get({ fileId: found.id, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return {
    config: normalizeScheduleConfig(parseDriveJson(response.data)),
    fileId: found.id,
    webViewLink: found.webViewLink,
  };
};

export const writeScheduleConfigToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  existingFileId: string | null,
  config = createDefaultScheduleConfig(),
) => {
  const payload = JSON.stringify(config, null, 2);

  if (existingFileId) {
    const updated = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.update(
            {
              fileId: existingFileId,
              media: { mimeType: 'application/json', body: payload },
              fields: 'id,webViewLink',
            },
            { signal: timeoutSignal },
          ),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );

    return { fileId: updated.data.id ?? existingFileId, webViewLink: updated.data.webViewLink ?? undefined };
  }

  const created = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: {
              name: SCHEDULE_CONFIG_FILENAME,
              parents: [folderId],
              mimeType: 'application/json',
            },
            media: { mimeType: 'application/json', body: payload },
            fields: 'id,webViewLink',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return { fileId: created.data.id ?? '', webViewLink: created.data.webViewLink ?? undefined };
};
