import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { OutsideFolderError } from '../../../../lib/driveSafety';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

export const GET = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/selection/read');
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

  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const fileId = request.nextUrl.searchParams.get('fileId');
  if (!fileId) {
    return respond(jsonError(400, 'invalid_request', 'File id is required.'));
  }

  const drive = createDriveClient(accessToken);

  try {
    const selectionSet = await time(ctx, 'drive.files.get.selection_set', () =>
      readSelectionSetFromDrive(drive, driveFolderId, fileId, ctx),
    );
    if (!selectionSet) {
      return respond(jsonError(400, 'invalid_request', 'Selection set not found.'));
    }

    return respond(NextResponse.json({ set: selectionSet }));
  } catch (error) {
    if (error instanceof OutsideFolderError) {
      return respond(
        jsonError(403, 'forbidden_outside_folder', 'Selection set is outside the app folder.'),
      );
    }
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
