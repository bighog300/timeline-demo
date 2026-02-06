import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';

export const GET = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const fileId = request.nextUrl.searchParams.get('fileId');
  if (!fileId) {
    return jsonError(400, 'invalid_request', 'File id is required.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const selectionSet = await readSelectionSetFromDrive(drive, session.driveFolderId, fileId);
    if (!selectionSet) {
      return jsonError(400, 'invalid_request', 'Selection set not found.');
    }

    return NextResponse.json({ set: selectionSet });
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
