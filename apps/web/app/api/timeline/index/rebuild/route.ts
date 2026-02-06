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
import { buildIndexFromDriveListing } from '../../../../lib/buildIndex';
import { findIndexFile, writeIndexFile } from '../../../../lib/indexDrive';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import { normalizeTimelineIndex } from '../../../../lib/validateIndex';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

const MAX_SCAN = 500;
const PAGE_SIZE = 100;

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/index/rebuild');
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

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 20, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  const drive = createDriveClient(accessToken);
  const files: Array<{
    id?: string | null;
    name?: string | null;
    modifiedTime?: string | null;
    webViewLink?: string | null;
  }> = [];
  let pageToken: string | undefined;
  let partial = false;

  try {
    do {
      const response = await time(ctx, 'drive.files.list.index_rebuild', () =>
        withRetry(
          (signal) =>
            withTimeout(
              (timeoutSignal) =>
                drive.files.list(
                  {
                    q: `'${driveFolderId}' in parents and trashed=false`,
                    orderBy: 'modifiedTime desc',
                    pageSize: PAGE_SIZE,
                    pageToken,
                    fields: 'nextPageToken, files(id, name, modifiedTime, webViewLink)',
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

      const nextFiles = response.data.files ?? [];
      files.push(...nextFiles);
      pageToken = response.data.nextPageToken ?? undefined;

      if (files.length >= MAX_SCAN) {
        partial = Boolean(pageToken);
        break;
      }
    } while (pageToken);

    const listing = files.slice(0, MAX_SCAN);
    const built = buildIndexFromDriveListing(listing);
    const existingIndex = await findIndexFile(drive, driveFolderId, ctx);
    const normalized = normalizeTimelineIndex(
      built,
      driveFolderId,
      existingIndex?.id ?? '',
    );
    const writeResult = await writeIndexFile(
      drive,
      driveFolderId,
      existingIndex?.id ?? null,
      normalized,
      ctx,
    );
    const finalIndex = normalizeTimelineIndex(
      {
        ...normalized,
        indexFileId: writeResult.fileId,
        updatedAtISO: new Date().toISOString(),
      },
      driveFolderId,
      writeResult.fileId,
    );

    return respond(
      NextResponse.json({
        index: finalIndex,
        partial: partial ? true : undefined,
      }),
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
};
