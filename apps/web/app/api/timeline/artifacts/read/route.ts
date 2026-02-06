import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { isSummaryArtifact, normalizeArtifact } from '../../../../lib/validateArtifact';

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
};

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
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const drive = createDriveClient(accessToken);

  const metaResponse = await drive.files.get({
    fileId,
    fields: 'id, name, parents, webViewLink',
  });

  const parents = metaResponse.data.parents ?? [];
  if (!parents.includes(session.driveFolderId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const contentResponse = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json' });
  const parsed = parseDriveJson(contentResponse.data);

  if (!isSummaryArtifact(parsed)) {
    return NextResponse.json({ error: 'invalid_artifact' }, { status: 422 });
  }

  const normalized = normalizeArtifact(parsed);
  return NextResponse.json({
    artifact: {
      ...normalized,
      driveFileId: normalized.driveFileId || fileId,
      driveWebViewLink: normalized.driveWebViewLink ?? metaResponse.data.webViewLink ?? undefined,
    },
  });
};
