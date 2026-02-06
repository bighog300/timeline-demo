import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';

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
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  const includeFolders = request.nextUrl.searchParams.get('includeFolders') === 'true';
  const drive = createDriveClient(accessToken);

  const q = includeFolders
    ? "trashed = false"
    : "trashed = false and mimeType != 'application/vnd.google-apps.folder'";

  const response = await drive.files.list({
    q,
    fields: 'files(id, name, mimeType, modifiedTime, iconLink)',
    orderBy: 'modifiedTime desc',
    pageSize: 20,
    spaces: 'drive',
  });

  const files: DriveFile[] = (response.data.files ?? []).map((file) => ({
    id: file.id ?? '',
    name: file.name ?? 'Untitled',
    mimeType: file.mimeType ?? 'application/octet-stream',
    modifiedTime: file.modifiedTime ?? undefined,
    iconLink: file.iconLink ?? undefined,
  }));

  return NextResponse.json({ files });
};
