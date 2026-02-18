import { NextResponse } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { listSelectionFiles } from '../../../../lib/driveSelections';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';

export const GET = async () => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken || !session.driveFolderId) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  try {
    const drive = createDriveClient(accessToken);
    const items = await listSelectionFiles(drive, session.driveFolderId);
    return NextResponse.json({ items });
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status === 401 ? 401 : 500, mapped.status === 401 ? mapped.code : 'internal_error', mapped.status === 401 ? mapped.message : 'Failed to list selection sets.');
  }
};
