import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';

export const GET = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const folderId = request.nextUrl.searchParams.get('folderId') ?? session.driveFolderId;

  try {
    const drive = createDriveClient(accessToken);
    const appFolderMeta = await drive.files.get({
      fileId: session.driveFolderId,
      fields: 'id, name',
    });

    const appCrumb = {
      id: session.driveFolderId,
      name: appFolderMeta.data.name ?? 'App folder',
    };

    if (folderId === session.driveFolderId) {
      return NextResponse.json({ folderId, crumbs: [appCrumb] });
    }

    const targetMeta = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, parents',
    });

    if (!(targetMeta.data.parents ?? []).includes(session.driveFolderId)) {
      return jsonError(403, 'forbidden', 'Folder is outside the app Drive scope.');
    }

    return NextResponse.json({
      folderId,
      crumbs: [
        appCrumb,
        {
          id: targetMeta.data.id ?? folderId,
          name: targetMeta.data.name ?? 'Folder',
        },
      ],
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
