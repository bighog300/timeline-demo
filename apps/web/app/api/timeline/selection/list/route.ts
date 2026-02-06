import { NextResponse } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { listSelectionSetsFromDrive } from '../../../../lib/listSelectionSetsFromDrive';

const stripSuffix = (name: string) => name.replace(/ - Selection\.json$/i, '').trim() || 'Untitled';

export const GET = async () => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  if (!session.driveFolderId) {
    return NextResponse.json({ error: 'drive_not_provisioned' }, { status: 400 });
  }

  const drive = createDriveClient(accessToken);
  const files = await listSelectionSetsFromDrive(drive, session.driveFolderId);

  return NextResponse.json({
    sets: files.map((file) => ({
      driveFileId: file.id,
      name: stripSuffix(file.name),
      updatedAtISO: file.modifiedTime ?? new Date().toISOString(),
      driveWebViewLink: file.webViewLink ?? undefined,
    })),
  });
};
