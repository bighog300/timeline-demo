import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import {
  getGoogleAccessToken,
  getGoogleSession,
  persistDriveFolderId,
} from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../../lib/googleRequest';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

const FOLDER_NAME = 'Timeline Demo (App Data)';

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

  let existing;
  try {
    existing = await time(ctx, 'drive.files.list', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.list(
                {
                  q: `mimeType = 'application/vnd.google-apps.folder' and name = '${FOLDER_NAME}' and trashed = false`,
                  fields: 'files(id, name)',
                  spaces: 'drive',
                  pageSize: 1,
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      ),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.list', ctx);
    const mapped = mapGoogleError(error, 'drive.files.list');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  const existingFolder = existing.data.files?.[0];

  if (existingFolder?.id && existingFolder.name) {
    const response = NextResponse.json({
      folderId: existingFolder.id,
      folderName: existingFolder.name,
    });
    await persistDriveFolderId(request, response, existingFolder.id);
    return respond(response);
  }

  let created;
  try {
    created = await time(ctx, 'drive.files.create', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.create(
                {
                  requestBody: {
                    name: FOLDER_NAME,
                    mimeType: 'application/vnd.google-apps.folder',
                  },
                  fields: 'id, name',
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      ),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.create', ctx);
    const mapped = mapGoogleError(error, 'drive.files.create');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  const folderId = created.data.id ?? '';
  const folderName = created.data.name ?? FOLDER_NAME;
  const response = NextResponse.json({ folderId, folderName });
  if (folderId) {
    await persistDriveFolderId(request, response, folderId);
  }
  return respond(response);
};
