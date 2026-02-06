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

const MAX_SCAN = 500;
const PAGE_SIZE = 100;

export const POST = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 20, windowMs: 60_000 });
  if (!rateStatus.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
      retryAfterMs: rateStatus.resetMs,
    });
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
      const response = await withRetry((signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: `'${session.driveFolderId}' in parents and trashed=false`,
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
    const existingIndex = await findIndexFile(drive, session.driveFolderId);
    const normalized = normalizeTimelineIndex(
      built,
      session.driveFolderId,
      existingIndex?.id ?? '',
    );
    const writeResult = await writeIndexFile(
      drive,
      session.driveFolderId,
      existingIndex?.id ?? null,
      normalized,
    );
    const finalIndex = normalizeTimelineIndex(
      {
        ...normalized,
        indexFileId: writeResult.fileId,
        updatedAtISO: new Date().toISOString(),
      },
      session.driveFolderId,
      writeResult.fileId,
    );

    return NextResponse.json({
      index: finalIndex,
      partial: partial ? true : undefined,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
