import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { isAdminSession } from '../../../../lib/adminAuth';
import { readAdminSettingsFromDrive } from '../../../../lib/adminSettingsDrive';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { hashUserHint, logError, logInfo, safeError } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

export const GET = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/admin/settings/get');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  if (!isAdminSession(session)) {
    return respond(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
  }

  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const drive = createDriveClient(accessToken);

  try {
    const result = await readAdminSettingsFromDrive(drive, driveFolderId, ctx);
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
