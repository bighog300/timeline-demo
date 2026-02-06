import { NextResponse } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { listSelectionSetsFromDrive } from '../../../../lib/listSelectionSetsFromDrive';

const stripSuffix = (name: string) => name.replace(/ - Selection\.json$/i, '').trim() || 'Untitled';

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
  let files;
  try {
    files = await listSelectionSetsFromDrive(drive, session.driveFolderId);
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  return NextResponse.json({
    sets: files.map((file) => ({
      driveFileId: file.id,
      name: stripSuffix(file.name),
      updatedAtISO: file.modifiedTime ?? new Date().toISOString(),
      driveWebViewLink: file.webViewLink ?? undefined,
    })),
  });
};
