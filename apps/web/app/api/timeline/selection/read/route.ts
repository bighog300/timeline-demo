import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';

export const GET = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  if (!session.driveFolderId) {
    return NextResponse.json({ error: 'drive_not_provisioned' }, { status: 400 });
  }

  const fileId = request.nextUrl.searchParams.get('fileId');
  if (!fileId) {
    return NextResponse.json({ error: 'missing_file_id' }, { status: 400 });
  }

  const drive = createDriveClient(accessToken);

  try {
    const selectionSet = await readSelectionSetFromDrive(drive, session.driveFolderId, fileId);
    if (!selectionSet) {
      return NextResponse.json({ error: 'selection_not_found' }, { status: 404 });
    }

    return NextResponse.json({ set: selectionSet });
  } catch (error) {
    console.warn('Failed to read selection set', {
      fileId,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
    return NextResponse.json({ error: 'selection_unavailable' }, { status: 500 });
  }
};
