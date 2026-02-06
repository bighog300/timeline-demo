import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { DEFAULT_INDEX_MAX_AGE_MINUTES, isIndexFresh } from '../../../../lib/indexFreshness';
import { findIndexFile, readIndexFile } from '../../../../lib/indexDrive';
import { hashUserHint, logError, logInfo, safeError } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

export const GET = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/index/get');
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

  const drive = createDriveClient(accessToken);

  try {
    const indexFile = await findIndexFile(drive, driveFolderId, ctx);
    if (!indexFile?.id) {
      return respond(NextResponse.json({ index: null }));
    }

    const index = await readIndexFile(drive, indexFile.id, driveFolderId, ctx);
    if (!index) {
      return respond(NextResponse.json({ index: null }));
    }

    const indexStale = !isIndexFresh(index, new Date(), DEFAULT_INDEX_MAX_AGE_MINUTES);
    return respond(NextResponse.json({ index, indexStale }));
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
