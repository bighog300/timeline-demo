import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { isAdminSession } from '../../../lib/adminAuth';
import { validateAdminSettingsInput } from '../../../lib/adminSettings';
import {
  findAdminSettingsFile,
  readAdminSettingsFromDrive,
  writeAdminSettingsToDrive,
} from '../../../lib/adminSettingsDrive';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';
import { hashUserHint, logError, logInfo, safeError } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';

const makeRespond = (request: NextRequest, path: string) => {
  const ctx = createCtx(request, path);
  const startedAt = Date.now();

  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  return { ctx, respond };
};

export const GET = async (request: NextRequest) => {
  const { ctx, respond } = makeRespond(request, '/api/admin/settings');
  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  if (!isAdminSession(session)) {
    return respond(jsonError(403, 'forbidden', 'Access denied.'));
  }

  if (!session.driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const drive = createDriveClient(accessToken);

  try {
    const result = await readAdminSettingsFromDrive(drive, session.driveFolderId, ctx);
    return respond(
      NextResponse.json({
        settings: result.settings,
        driveFileId: result.fileId,
        driveWebViewLink: result.webViewLink,
      }),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.get', ctx);
    const mapped = mapGoogleError(error, 'drive.files.get');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }
};

export const PUT = async (request: NextRequest) => {
  const { ctx, respond } = makeRespond(request, '/api/admin/settings');
  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  if (!isAdminSession(session)) {
    return respond(jsonError(403, 'forbidden', 'Access denied.'));
  }

  if (!session.driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const validation = validateAdminSettingsInput(body);
  if (!validation.settings) {
    return respond(jsonError(400, 'invalid_request', validation.error ?? 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);

  try {
    const existing = await findAdminSettingsFile(drive, session.driveFolderId, ctx);
    const result = await writeAdminSettingsToDrive(
      drive,
      session.driveFolderId,
      existing?.id ?? null,
      validation.settings,
      ctx,
    );

    return respond(
      NextResponse.json({
        settings: validation.settings,
        driveFileId: result.fileId,
        driveWebViewLink: result.webViewLink ?? existing?.webViewLink,
      }),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.update', ctx);
    const mapped = mapGoogleError(error, 'drive.files.update');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }
};
