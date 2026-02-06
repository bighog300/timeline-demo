import { NextResponse, type NextRequest } from 'next/server';

import {
  getGoogleAccessToken,
  getGoogleSession,
  persistDriveFolderId,
} from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';

const FOLDER_NAME = 'Timeline Demo (App Data)';

export const POST = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  const drive = createDriveClient(accessToken);

  const existing = await drive.files.list({
    q: `mimeType = 'application/vnd.google-apps.folder' and name = '${FOLDER_NAME}' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    pageSize: 1,
  });

  const existingFolder = existing.data.files?.[0];

  if (existingFolder?.id && existingFolder.name) {
    const response = NextResponse.json({
      folderId: existingFolder.id,
      folderName: existingFolder.name,
    });
    await persistDriveFolderId(request, response, existingFolder.id);
    return response;
  }

  const created = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id, name',
  });

  const folderId = created.data.id ?? '';
  const folderName = created.data.name ?? FOLDER_NAME;
  const response = NextResponse.json({ folderId, folderName });
  if (folderId) {
    await persistDriveFolderId(request, response, folderId);
  }
  return response;
};
