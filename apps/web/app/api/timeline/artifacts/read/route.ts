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
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import { isSummaryArtifact, normalizeArtifact } from '../../../../lib/validateArtifact';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
};

export const GET = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/artifacts/read');
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

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 60, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  const drive = createDriveClient(accessToken);

  let metaResponse;
  try {
    metaResponse = await time(ctx, 'drive.files.get.metadata', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.get(
                {
                  fileId,
                  fields: 'id, name, parents, webViewLink',
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
    logGoogleError(error, 'drive.files.get', ctx);
    const mapped = mapGoogleError(error, 'drive.files.get');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  const parents = metaResponse.data.parents ?? [];
  if (!parents.includes(driveFolderId)) {
    return respond(
      jsonError(403, 'forbidden_outside_folder', 'Artifact is outside the app folder.'),
    );
  }

  let contentResponse;
  try {
    contentResponse = await time(ctx, 'drive.files.get.media', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'json', signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      ),
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
  const parsed = parseDriveJson(contentResponse.data);

  if (!isSummaryArtifact(parsed)) {
    return respond(jsonError(400, 'invalid_request', 'Artifact data was invalid.'));
  }

  const normalized = normalizeArtifact(parsed);
  return respond(
    NextResponse.json({
      artifact: {
        ...normalized,
        driveFileId: normalized.driveFileId || fileId,
        driveWebViewLink: normalized.driveWebViewLink ?? metaResponse.data.webViewLink ?? undefined,
      },
    }),
  );
};
