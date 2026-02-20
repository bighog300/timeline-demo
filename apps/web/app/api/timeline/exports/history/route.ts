import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { readExportHistory } from '../../../../lib/timeline/exportHistoryDrive';

export const runtime = 'nodejs';

const parseLimit = (request: NextRequest) => {
  const raw = new URL(request.url).searchParams.get('limit');
  if (!raw) return 20;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
};

export const GET = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const drive = createDriveClient(accessToken);
  const history = await readExportHistory(drive, session.driveFolderId);
  const limit = parseLimit(request);
  const newestFirst = [...history.items].reverse().slice(0, limit);

  return NextResponse.json({
    items: newestFirst,
    updatedAtISO: history.updatedAtISO,
  });
};
