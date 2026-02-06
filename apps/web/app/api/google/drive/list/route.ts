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

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  iconLink?: string;
};

export const GET = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/google/drive/list');
  const startedAt = Date.now();
  const url = request.nextUrl ?? new URL(request.url);
  const includeFoldersParam = url.searchParams.get('includeFolders') === 'true';
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', {
    method: request.method,
    includeFolders: includeFoldersParam,
  });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const includeFolders = includeFoldersParam;
  const drive = createDriveClient(accessToken);

  const q = includeFolders
    ? "trashed = false"
    : "trashed = false and mimeType != 'application/vnd.google-apps.folder'";

  let response;
  try {
    response = await time(ctx, 'drive.files.list', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.list(
                {
                  q,
                  fields: 'files(id, name, mimeType, modifiedTime, iconLink)',
                  orderBy: 'modifiedTime desc',
                  pageSize: 20,
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

  const files: DriveFile[] = (response.data.files ?? []).map((file) => ({
    id: file.id ?? '',
    name: file.name ?? 'Untitled',
    mimeType: file.mimeType ?? 'application/octet-stream',
    modifiedTime: file.modifiedTime ?? undefined,
    iconLink: file.iconLink ?? undefined,
  }));

  return respond(NextResponse.json({ files }));
};
