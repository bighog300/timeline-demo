import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../../lib/googleRequest';

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  iconLink?: string;
};

export const GET = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  const includeFolders = request.nextUrl.searchParams.get('includeFolders') === 'true';
  const drive = createDriveClient(accessToken);

  const q = includeFolders
    ? "trashed = false"
    : "trashed = false and mimeType != 'application/vnd.google-apps.folder'";

  let response;
  try {
    response = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.list(
            {
              q,
              fields: 'files(id, name, mimeType, modifiedTime, iconLink)',
              orderBy: 'modifiedTime desc',
              pageSize: 20,
              spaces: 'drive',
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

  const files: DriveFile[] = (response.data.files ?? []).map((file) => ({
    id: file.id ?? '',
    name: file.name ?? 'Untitled',
    mimeType: file.mimeType ?? 'application/octet-stream',
    modifiedTime: file.modifiedTime ?? undefined,
    iconLink: file.iconLink ?? undefined,
  }));

  return NextResponse.json({ files });
};
