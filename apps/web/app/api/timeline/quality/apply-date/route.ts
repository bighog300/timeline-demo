import { NextResponse, type NextRequest } from 'next/server';
import { isoDateString } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../../../../lib/googleRequest';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../../lib/requestContext';
import { hashUserHint, logInfo } from '../../../../lib/logger';
import { loadArtifactIndex, saveArtifactIndex, upsertArtifactIndexEntry } from '../../../../lib/timeline/artifactIndex';
import { isSummaryArtifact, normalizeArtifact } from '../../../../lib/validateArtifact';

const RequestSchema = z.object({
  artifactId: z.string().min(1),
  contentDateISO: isoDateString,
}).strict();

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/quality/apply-date');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();
  if (!session || !accessToken) return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  if (!session.driveFolderId) return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';
  const rate = checkRateLimit(getRateLimitKey(request, session), { limit: 30, windowMs: 60_000 }, ctx);
  if (!rate.allowed) return respond(jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.'));

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);

  let raw: unknown;
  try {
    const response = await withRetry((signal) => withTimeout((timeoutSignal) =>
      drive.files.get({ fileId: body.artifactId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ));
    raw = parseDriveJson(response.data);
  } catch {
    return respond(jsonError(404, 'not_found', 'Artifact not found.'));
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !isSummaryArtifact(raw)) {
    return respond(jsonError(400, 'invalid_request', 'Artifact data was invalid.'));
  }

  const artifact = normalizeArtifact(raw);
  const nextRaw = {
    ...(raw as Record<string, unknown>),
    contentDateISO: body.contentDateISO,
    updatedAtISO: new Date().toISOString(),
  };

  try {
    await withRetry((signal) => withTimeout((timeoutSignal) =>
      drive.files.update({ fileId: body.artifactId, media: { mimeType: 'application/json', body: JSON.stringify(nextRaw, null, 2) } }, { signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ));
  } catch {
    return respond(jsonError(500, 'upstream_error', 'Unable to persist artifact update.'));
  }

  try {
    const loaded = await loadArtifactIndex(drive, session.driveFolderId, ctx);
    const existing = loaded.index.artifacts.find((entry) => entry.driveFileId === body.artifactId || entry.id === artifact.artifactId);
    if (existing) {
      const nextIndex = upsertArtifactIndexEntry(loaded.index, {
        ...existing,
        id: artifact.artifactId,
        driveFileId: body.artifactId,
        contentDateISO: body.contentDateISO,
        updatedAtISO: new Date().toISOString(),
      });
      await saveArtifactIndex(drive, session.driveFolderId, loaded.fileId, nextIndex, ctx);
    }
  } catch {
    // best effort
  }

  return respond(NextResponse.json({ ok: true, artifactId: body.artifactId, contentDateISO: body.contentDateISO }));
};
