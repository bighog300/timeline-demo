import { NextResponse, type NextRequest } from 'next/server';

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

type SearchBody = {
  q?: string;
  pageToken?: string | null;
  pageSize?: number | null;
};

const MAX_QUERY_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 50;
const HARD_MAX_PAGE_SIZE = 100;

const createErrorResponse = (
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) =>
  NextResponse.json(
    {
      ok: false,
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
    { status },
  );

const mapAuthError = (error: unknown, requestName: string) => {
  const status =
    typeof error === 'object' && error && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;

  if (status === 401) {
    return {
      status: 401,
      code: 'reconnect_required',
      message: 'Reconnect Google',
      details: { request: requestName, status },
    };
  }

  return mapGoogleError(error, requestName);
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/google/drive/search');
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
    return respond(createErrorResponse(401, 'reconnect_required', 'Reconnect Google', ctx.requestId));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return respond(createErrorResponse(400, 'invalid_request', 'Invalid request body', ctx.requestId));
  }

  const q = typeof body.q === 'string' ? body.q.trim() : '';
  if (!q || q.length > MAX_QUERY_LENGTH) {
    return respond(
      createErrorResponse(
        400,
        'invalid_request',
        `Query is required and must be <= ${MAX_QUERY_LENGTH} characters`,
        ctx.requestId,
      ),
    );
  }

  const parsedPageSize =
    typeof body.pageSize === 'number' && Number.isFinite(body.pageSize)
      ? Math.floor(body.pageSize)
      : DEFAULT_PAGE_SIZE;

  if (parsedPageSize < 1 || parsedPageSize > HARD_MAX_PAGE_SIZE) {
    return respond(
      createErrorResponse(
        400,
        'invalid_request',
        `pageSize must be between 1 and ${HARD_MAX_PAGE_SIZE}`,
        ctx.requestId,
      ),
    );
  }

  const pageToken = typeof body.pageToken === 'string' && body.pageToken.trim() ? body.pageToken.trim() : undefined;

  const drive = createDriveClient(accessToken);

  try {
    const response = await time(ctx, 'drive.files.list', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.list(
                {
                  q,
                  pageToken,
                  pageSize: parsedPageSize,
                  orderBy: 'modifiedTime desc',
                  fields:
                    'nextPageToken, files(id,name,mimeType,modifiedTime,createdTime,owners(displayName,emailAddress),size,webViewLink,parents)',
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

    const files = (response.data.files ?? []).map((file) => ({
      id: file.id ?? '',
      name: file.name ?? 'Untitled',
      mimeType: file.mimeType ?? 'application/octet-stream',
      modifiedTime: file.modifiedTime ?? null,
      createdTime: file.createdTime ?? null,
      size: file.size ?? null,
      webViewLink: file.webViewLink ?? null,
      owner: {
        name: file.owners?.[0]?.displayName ?? '',
        email: file.owners?.[0]?.emailAddress ?? '',
      },
      parents: file.parents ?? [],
    }));

    return respond(
      NextResponse.json({
        ok: true,
        requestId: ctx.requestId,
        query: q,
        resultCount: files.length,
        nextPageToken: response.data.nextPageToken ?? null,
        files,
      }),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.list', ctx);
    const mapped = mapAuthError(error, 'drive.files.list');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(createErrorResponse(mapped.status, mapped.code, mapped.message, ctx.requestId, mapped.details));
  }
};
