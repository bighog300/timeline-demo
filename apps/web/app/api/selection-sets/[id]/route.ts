import { NextResponse } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';
import { readSelectionSetFromDrive } from '../../../lib/selectionSets';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const { id: rawId } = await params;
  const id = rawId?.trim();
  if (!id) {
    return jsonError(400, 'invalid_request', 'Selection set id is required.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const set = await readSelectionSetFromDrive(drive, session.driveFolderId, id);
    if (!set) {
      return jsonError(404, 'invalid_request', 'Selection set not found.');
    }

    return NextResponse.json({ set });
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
}
