import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import {
  getGoogleAccessToken,
  getGoogleSession,
  persistDriveFolderId,
} from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../../lib/googleRequest';

const FOLDER_NAME = 'Timeline Demo (App Data)';

export const POST = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  const drive = createDriveClient(accessToken);

  let existing;
  try {
    existing = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.list(
            {
              q: `mimeType = 'application/vnd.google-apps.folder' and name = '${FOLDER_NAME}' and trashed = false`,
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
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  const existingFolder = existing.data.files?.[0];

  if (existingFolder?.id && existingFolder.name) {
    const response = NextResponse.json({
      folderId: existingFolder.id,
      folderName: existingFolder.name,
    });
    await persistDriveFolderId(request, response, existingFolder.id);
    return response;
  }

  let created;
  try {
    created = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.create(
            {
              requestBody: {
                name: FOLDER_NAME,
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
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.create');
    const mapped = mapGoogleError(error, 'drive.files.create');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  const folderId = created.data.id ?? '';
  const folderName = created.data.name ?? FOLDER_NAME;
  const response = NextResponse.json({ folderId, folderName });
  if (folderId) {
    await persistDriveFolderId(request, response, folderId);
  }
  return response;
};
