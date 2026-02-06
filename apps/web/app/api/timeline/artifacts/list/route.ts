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
import { DEFAULT_INDEX_MAX_AGE_MINUTES, isIndexFresh } from '../../../../lib/indexFreshness';
import { findIndexFile, readIndexFile } from '../../../../lib/indexDrive';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import type { SummaryArtifact } from '../../../../lib/types';
import { isSummaryArtifact, normalizeArtifact } from '../../../../lib/validateArtifact';
import { hashUserHint, logError, logInfo, logWarn, safeError, time } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

const DEFAULT_PAGE_SIZE = 50;
const MAX_JSON_DOWNLOADS = 20;

type ArtifactFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const isArtifactJson = (file: { name?: string | null; mimeType?: string | null }) => {
  const name = file.name ?? '';
  const hasSummaryName = name.includes(' - Summary.json');
  const hasJsonSuffix = name.endsWith(' - Summary.json');
  return hasSummaryName || (file.mimeType === 'application/json' && hasJsonSuffix);
};

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
  const ctx = createCtx(request, '/api/timeline/artifacts/list');
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
  const rateStatus = checkRateLimit(rateKey, { limit: 60, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  const pageToken = request.nextUrl.searchParams.get('pageToken') ?? undefined;
  const pageSize = Number(request.nextUrl.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE;

  const drive = createDriveClient(accessToken);

  let files: ArtifactFile[] = [];
  let nextPageToken: string | undefined;
  let fromIndex = false;
  let indexStale = false;

  try {
    const indexFile = await findIndexFile(drive, driveFolderId, ctx);
    if (indexFile?.id) {
      const index = await readIndexFile(drive, indexFile.id, driveFolderId, ctx);
      if (index) {
        fromIndex = true;
        indexStale = !isIndexFresh(index, new Date(), DEFAULT_INDEX_MAX_AGE_MINUTES);
        const startIndex = pageToken ? Number(pageToken) : 0;
        const safeStartIndex = Number.isFinite(startIndex) && startIndex >= 0 ? startIndex : 0;
        const page = index.summaries.slice(safeStartIndex, safeStartIndex + pageSize);
        nextPageToken =
          safeStartIndex + pageSize < index.summaries.length
            ? String(safeStartIndex + pageSize)
            : undefined;
        files = page.map((summary) => ({
          id: summary.driveFileId,
          name: `${summary.title} - Summary.json`,
          modifiedTime: summary.updatedAtISO ?? undefined,
          webViewLink: summary.webViewLink ?? undefined,
        }));
      }
    }
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

  if (!fromIndex) {
    let listResponse;
    try {
      listResponse = await time(ctx, 'drive.files.list', () =>
        withRetry(
          (signal) =>
            withTimeout(
              (timeoutSignal) =>
                drive.files.list(
                  {
                    q: `'${driveFolderId}' in parents and trashed=false`,
                    orderBy: 'modifiedTime desc',
                    pageSize,
                    pageToken,
                    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
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

    const listedFiles = (listResponse.data.files ?? []).filter(isArtifactJson);
    files = listedFiles.map((file) => ({
      id: file.id ?? '',
      name: file.name ?? 'Untitled Summary',
      modifiedTime: file.modifiedTime ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
    }));
    nextPageToken = listResponse.data.nextPageToken ?? undefined;
  }

  const artifacts: SummaryArtifact[] = [];
  for (const file of files.slice(0, MAX_JSON_DOWNLOADS)) {
    if (!file.id) {
      continue;
    }
    const fileId = file.id;

    try {
      const contentResponse = await time(ctx, 'drive.files.get.media', () =>
        withRetry(
          (signal) =>
            withTimeout(
              (timeoutSignal) =>
                drive.files.get(
                  { fileId, alt: 'media' },
                  {
                    responseType: 'json',
                    signal: timeoutSignal,
                  },
                ),
              DEFAULT_GOOGLE_TIMEOUT_MS,
              'upstream_timeout',
              signal,
            ),
          { ctx },
        ),
      );
      const parsed = parseDriveJson(contentResponse.data);

      if (isSummaryArtifact(parsed)) {
        const normalized = normalizeArtifact(parsed);
        artifacts.push({
          ...normalized,
          driveFileId: normalized.driveFileId || file.id,
          driveWebViewLink: normalized.driveWebViewLink ?? file.webViewLink ?? undefined,
        });
      } else {
        logWarn(ctx, 'artifact_json_invalid');
      }
    } catch (error) {
      logWarn(ctx, 'artifact_json_read_failed', { error: safeError(error) });
    }
  }

  return respond(
    NextResponse.json({
      artifacts,
      files,
      nextPageToken,
      fromIndex,
      indexStale: fromIndex ? indexStale : undefined,
    }),
  );
};
