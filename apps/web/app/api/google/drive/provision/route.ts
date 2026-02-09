import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import {
  getGoogleAccessToken,
  getGoogleSession,
  persistDriveFolderId,
} from '../../../../lib/googleAuth';
import {
  AppDriveFolderResolveError,
  resolveOrProvisionAppDriveFolder,
} from '../../../../lib/appDriveFolder';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { hashUserHint, logError, logInfo, safeError } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/google/drive/provision');
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

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const drive = createDriveClient(accessToken);

  let folder;
  try {
    folder = await resolveOrProvisionAppDriveFolder(drive, ctx);
  } catch (error) {
    if (error instanceof AppDriveFolderResolveError) {
      logGoogleError(error.cause, error.operation, ctx);
      const mapped = mapGoogleError(error.cause, error.operation);
      logError(ctx, 'request_error', {
        status: mapped.status,
        code: mapped.code,
        error: safeError(error.cause),
      });
      return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
    }
    logError(ctx, 'request_error', {
      status: 500,
      code: 'upstream_error',
      error: safeError(error),
    });
    return respond(
      jsonError(500, 'upstream_error', 'Unable to provision the Drive folder.'),
    );
  }

  if (!folder?.id) {
    logError(ctx, 'request_error', {
      status: 500,
      code: 'upstream_error',
      error: safeError('Drive folder provisioning returned no id.'),
    });
    return respond(
      jsonError(500, 'upstream_error', 'Unable to provision the Drive folder.'),
    );
  }

  const response = NextResponse.json({ folderId: folder.id, folderName: folder.name });
  await persistDriveFolderId(request, response, folder.id);
  return respond(response);
};
