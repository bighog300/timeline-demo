import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { time } from './logger';

const APP_DRIVE_FOLDER_NAME = 'Timeline Demo (App Data)';

type AppDriveFolder = {
  id: string;
  name: string;
};

type DriveOperation = 'drive.files.list' | 'drive.files.create';

export class AppDriveFolderResolveError extends Error {
  operation: DriveOperation;
  cause: unknown;

  constructor(operation: DriveOperation, cause: unknown) {
    super('Failed to resolve app Drive folder.');
    this.name = 'AppDriveFolderResolveError';
    this.operation = operation;
    this.cause = cause;
  }
}

const listAppDriveFolder = async (drive: drive_v3.Drive, ctx: LogContext) => {
  try {
    return await time(ctx, 'drive.files.list', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.list(
                {
                  q: `mimeType = 'application/vnd.google-apps.folder' and name = '${APP_DRIVE_FOLDER_NAME}' and trashed = false`,
                  fields: 'files(id, name)',
                  spaces: 'drive',
                  pageSize: 1,
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      ),
    );
  } catch (error) {
    throw new AppDriveFolderResolveError('drive.files.list', error);
  }
};

const createAppDriveFolder = async (drive: drive_v3.Drive, ctx: LogContext) => {
  try {
    return await time(ctx, 'drive.files.create', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.create(
                {
                  requestBody: {
                    name: APP_DRIVE_FOLDER_NAME,
                    mimeType: 'application/vnd.google-apps.folder',
                  },
                  fields: 'id, name',
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      ),
    );
  } catch (error) {
    throw new AppDriveFolderResolveError('drive.files.create', error);
  }
};

export const resolveOrProvisionAppDriveFolder = async (
  drive: drive_v3.Drive,
  ctx: LogContext,
): Promise<AppDriveFolder | null> => {
  const existing = await listAppDriveFolder(drive, ctx);
  const existingFolder = existing.data.files?.[0];

  if (existingFolder?.id) {
    return {
      id: existingFolder.id,
      name: existingFolder.name ?? APP_DRIVE_FOLDER_NAME,
    };
  }

  const created = await createAppDriveFolder(drive, ctx);
  const folderId = created.data.id ?? '';
  if (!folderId) {
    return null;
  }

  return {
    id: folderId,
    name: created.data.name ?? APP_DRIVE_FOLDER_NAME,
  };
};
