import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../lib/googleRequest';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { hashUserHint, logError, logInfo, logWarn, safeError, time } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import type { CalendarEntry } from '../../../lib/types';
import { isCalendarEntry, normalizeCalendarEntry } from '../../../lib/validateCalendarEntry';

const DEFAULT_PAGE_SIZE = 100;
const MAX_JSON_DOWNLOADS = 50;

type CalendarEntryFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const isCalendarEntryJson = (file: { name?: string | null; mimeType?: string | null }) => {
  const name = file.name ?? '';
  const hasCalendarEntryName = name.includes('CalendarEntry.json');
  return hasCalendarEntryName || (file.mimeType === 'application/json' && name.endsWith('CalendarEntry.json'));
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
  const ctx = createCtx(request, '/api/calendar/entries');
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
  const pageSize = Math.min(
    Number(request.nextUrl.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
  );

  const drive = createDriveClient(accessToken);

  let files: CalendarEntryFile[] = [];
  let nextPageToken: string | undefined;

  try {
    const listResponse = await time(ctx, 'drive.files.list', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.list(
                {
                  q: `'${driveFolderId}' in parents and trashed=false and name contains 'CalendarEntry.json'`,
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

    const listedFiles = (listResponse.data.files ?? []).filter(isCalendarEntryJson);
    files = listedFiles.map((file) => ({
      id: file.id ?? '',
      name: file.name ?? 'Untitled Calendar Entry',
      modifiedTime: file.modifiedTime ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
    }));
    nextPageToken = listResponse.data.nextPageToken ?? undefined;
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

  const entries: CalendarEntry[] = [];
  for (const file of files.slice(0, MAX_JSON_DOWNLOADS)) {
    if (!file.id) {
      continue;
    }

    try {
      const contentResponse = await time(ctx, 'drive.files.get.media', () =>
        withRetry(
          (signal) =>
            withTimeout(
              (timeoutSignal) =>
                drive.files.get(
                  { fileId: file.id, alt: 'media' },
                  { responseType: 'json', signal: timeoutSignal },
                ),
              DEFAULT_GOOGLE_TIMEOUT_MS,
              'upstream_timeout',
              signal,
            ),
          { ctx },
        ),
      );

      const parsed = parseDriveJson(contentResponse.data);
      if (isCalendarEntry(parsed)) {
        entries.push(normalizeCalendarEntry(parsed));
      } else {
        logWarn(ctx, 'calendar_entry_invalid');
      }
    } catch (error) {
      logWarn(ctx, 'calendar_entry_read_failed', { error: safeError(error) });
    }
  }

  return respond(NextResponse.json({ entries, nextPageToken }));
};
