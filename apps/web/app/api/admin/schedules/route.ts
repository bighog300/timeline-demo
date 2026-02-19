import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { isAdminSession } from '../../../lib/adminAuth';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { readScheduleConfigFromDrive, writeScheduleConfigToDrive } from '../../../lib/scheduler/scheduleConfigDrive';
import { validateScheduleConfigInput } from '../../../lib/scheduler/scheduleConfig';

export const GET = async (_request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) return jsonError(401, 'reconnect_required', 'Reconnect required.');
  if (!isAdminSession(session)) return jsonError(403, 'forbidden', 'Access denied.');
  if (!session.driveFolderId) return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');

  const drive = createDriveClient(accessToken);
  const loaded = await readScheduleConfigFromDrive(drive, session.driveFolderId);

  return NextResponse.json({
    config: loaded.config,
    driveFileId: loaded.fileId,
    driveWebViewLink: loaded.webViewLink,
  });
};

export const PUT = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) return jsonError(401, 'reconnect_required', 'Reconnect required.');
  if (!isAdminSession(session)) return jsonError(403, 'forbidden', 'Access denied.');
  if (!session.driveFolderId) return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  const validation = validateScheduleConfigInput(body);
  if (!validation.config) {
    return jsonError(400, 'invalid_request', validation.error ?? 'Invalid request payload.');
  }

  const drive = createDriveClient(accessToken);
  const existing = await readScheduleConfigFromDrive(drive, session.driveFolderId);
  const saved = await writeScheduleConfigToDrive(
    drive,
    session.driveFolderId,
    existing.fileId,
    validation.config,
  );

  return NextResponse.json({
    config: validation.config,
    driveFileId: saved.fileId,
    driveWebViewLink: saved.webViewLink,
  });
};
