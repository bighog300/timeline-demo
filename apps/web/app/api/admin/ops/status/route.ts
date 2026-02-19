import { NextResponse } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { isAdminSession } from '../../../../lib/adminAuth';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { readOpsStatus } from '../../../../lib/ops/opsStatus';

export const GET = async () => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) return jsonError(401, 'reconnect_required', 'Reconnect required.');
  if (!isAdminSession(session)) return jsonError(403, 'forbidden', 'Access denied.');
  if (!session.driveFolderId) return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');

  const drive = createDriveClient(accessToken);
  const status = await readOpsStatus({ drive, driveFolderId: session.driveFolderId });
  return NextResponse.json(status);
};
