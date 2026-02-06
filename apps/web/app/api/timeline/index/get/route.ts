import { NextResponse } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { DEFAULT_INDEX_MAX_AGE_MINUTES, isIndexFresh } from '../../../../lib/indexFreshness';
import { findIndexFile, readIndexFile } from '../../../../lib/indexDrive';

export const GET = async () => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const indexFile = await findIndexFile(drive, session.driveFolderId);
    if (!indexFile?.id) {
      return NextResponse.json({ index: null });
    }

    const index = await readIndexFile(drive, indexFile.id, session.driveFolderId);
    if (!index) {
      return NextResponse.json({ index: null });
    }

    const indexStale = !isIndexFresh(index, new Date(), DEFAULT_INDEX_MAX_AGE_MINUTES);
    return NextResponse.json({ index, indexStale });
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
