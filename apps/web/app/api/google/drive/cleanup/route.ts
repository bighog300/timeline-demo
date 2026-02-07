import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
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

type CleanupBody = {
  dryRun?: boolean;
  confirm?: boolean;
};

type DriveCleanupFile = {
  id: string;
  name: string;
  webViewLink?: string;
};

const listAllFilesInFolder = async (drive: ReturnType<typeof createDriveClient>, folderId: string, ctx: ReturnType<typeof createCtx>) => {
  const files: DriveCleanupFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await time(ctx, 'drive.files.list.cleanup', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.list(
                {
                  q: `'${folderId}' in parents and trashed=false`,
                  fields: 'nextPageToken, files(id, name, webViewLink)',
                  pageSize: 100,
                  pageToken,
                  spaces: 'drive',
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

    for (const file of response.data.files ?? []) {
      if (file.id) {
        files.push({
          id: file.id,
          name: file.name ?? 'Untitled',
          webViewLink: file.webViewLink ?? undefined,
        });
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/google/drive/cleanup');
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

  let body: CleanupBody = {};
  try {
    body = (await request.json()) as CleanupBody;
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  if (!body.dryRun && !body.confirm) {
    return respond(
      jsonError(400, 'invalid_request', 'Specify dryRun to preview or confirm to delete.'),
    );
  }

  const drive = createDriveClient(accessToken);

  let files: DriveCleanupFile[] = [];
  try {
    files = await listAllFilesInFolder(drive, driveFolderId, ctx);
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

  if (body.dryRun && !body.confirm) {
    return respond(NextResponse.json({ dryRun: true, files }));
  }

  const deleted: string[] = [];
  for (const file of files) {
    try {
      await time(ctx, 'drive.files.delete.cleanup', () =>
        withRetry(
          (signal) =>
            withTimeout(
              (timeoutSignal) => drive.files.delete({ fileId: file.id }, { signal: timeoutSignal }),
              DEFAULT_GOOGLE_TIMEOUT_MS,
              'upstream_timeout',
              signal,
            ),
          { ctx },
        ),
      );
      deleted.push(file.id);
    } catch (error) {
      logGoogleError(error, 'drive.files.delete', ctx);
      const mapped = mapGoogleError(error, 'drive.files.delete');
      logError(ctx, 'request_error', {
        status: mapped.status,
        code: mapped.code,
        error: safeError(error),
      });
      return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
    }
  }

  return respond(
    NextResponse.json({
      deletedCount: deleted.length,
      deletedIds: deleted,
    }),
  );
};
