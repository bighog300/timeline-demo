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
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const fileId = request.nextUrl.searchParams.get('fileId');
  if (!fileId) {
    return jsonError(400, 'invalid_request', 'File id is required.');
  }

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 60, windowMs: 60_000 });
  if (!rateStatus.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
      retryAfterMs: rateStatus.resetMs,
    });
  }

  const drive = createDriveClient(accessToken);

  let metaResponse;
  try {
    metaResponse = await withRetry((signal) =>
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
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  const parents = metaResponse.data.parents ?? [];
  if (!parents.includes(session.driveFolderId)) {
    return jsonError(400, 'invalid_request', 'Artifact not found.');
  }

  let contentResponse;
  try {
    contentResponse = await withRetry((signal) =>
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
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
  const parsed = parseDriveJson(contentResponse.data);

  if (!isSummaryArtifact(parsed)) {
    return jsonError(400, 'invalid_request', 'Artifact data was invalid.');
  }

  const normalized = normalizeArtifact(parsed);
  return NextResponse.json({
    artifact: {
      ...normalized,
      driveFileId: normalized.driveFileId || fileId,
      driveWebViewLink: normalized.driveWebViewLink ?? metaResponse.data.webViewLink ?? undefined,
    },
  });
};
