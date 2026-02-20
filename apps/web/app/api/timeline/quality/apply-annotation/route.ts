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
import { isSummaryArtifact } from '../../../../lib/validateArtifact';

const AnnotationPatchSchema = z.object({
  entities: z.array(z.string().trim().min(1).max(50)).max(25).optional(),
  location: z.string().trim().max(200).optional(),
  amount: z.string().trim().max(200).optional(),
  note: z.string().trim().max(200).optional(),
}).strict();

const RequestSchema = z.object({
  artifactId: z.string().min(1),
  patch: AnnotationPatchSchema,
}).strict();

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

const applyPatch = (current: Record<string, unknown> | undefined, patch: z.infer<typeof AnnotationPatchSchema>) => {
  const next: Record<string, unknown> = { ...(current ?? {}) };

  if ('entities' in patch) {
    if (!patch.entities || patch.entities.length === 0) {
      delete next.entities;
    } else {
      next.entities = patch.entities;
    }
  }
  if ('location' in patch) {
    if (!patch.location) delete next.location;
    else next.location = patch.location;
  }
  if ('amount' in patch) {
    if (!patch.amount) delete next.amount;
    else next.amount = patch.amount;
  }
  if ('note' in patch) {
    if (!patch.note) delete next.note;
    else next.note = patch.note;
  }

  next.updatedAtISO = new Date().toISOString();

  if (Object.keys(next).length === 1 && typeof next.updatedAtISO === 'string' && isoDateString.safeParse(next.updatedAtISO).success) {
    return undefined;
  }

  return next;
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/quality/apply-annotation');
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
  const rate = checkRateLimit(getRateLimitKey(request, session), { limit: 60, windowMs: 60_000 }, ctx);
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

  const rawRecord = raw as Record<string, unknown>;
  const current = rawRecord.userAnnotations && typeof rawRecord.userAnnotations === 'object' && !Array.isArray(rawRecord.userAnnotations)
    ? rawRecord.userAnnotations as Record<string, unknown>
    : undefined;

  const nextAnnotations = applyPatch(current, body.patch);
  const nextRaw = {
    ...rawRecord,
    userAnnotations: nextAnnotations,
    updatedAtISO: new Date().toISOString(),
  } as Record<string, unknown>;

  if (!nextAnnotations) {
    delete nextRaw.userAnnotations;
  }

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

  return respond(NextResponse.json({ ok: true, artifactId: body.artifactId, userAnnotations: nextAnnotations ?? {} }));
};
