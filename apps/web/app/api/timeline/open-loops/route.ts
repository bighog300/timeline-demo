import { NextResponse, type NextRequest } from 'next/server';
import { DriveSummaryJsonSchema, OpenLoopSchema, SynthesisArtifactSchema, isoDateString } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { hashUserHint, logInfo } from '../../../lib/logger';
import { loadArtifactIndex, saveArtifactIndex, upsertArtifactIndexEntry } from '../../../lib/timeline/artifactIndex';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../../../lib/googleRequest';

const RequestSchema = z.object({
  artifactId: z.string().min(1),
  openLoopIndex: z.number().int().min(0).optional(),
  openLoopText: z.string().trim().min(1).optional(),
  action: z.enum(['close', 'reopen', 'edit']),
  patch: z.object({
    text: z.string().trim().min(3).max(240).optional(),
    owner: z.string().trim().min(0).max(120).nullable().optional(),
    dueDateISO: z.union([isoDateString, z.null()]).optional(),
    closedReason: z.string().trim().min(0).max(240).nullable().optional(),
  }).strict().optional(),
  sourceActionId: z.string().min(1).nullable().optional(),
}).strict().refine((value) => typeof value.openLoopIndex === 'number' || typeof value.openLoopText === 'string', {
  message: 'Provide openLoopIndex or openLoopText.',
});

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try { return JSON.parse(data) as unknown; } catch { return null; }
  }
  return data;
};

const parseArtifact = (value: unknown) => {
  const synthesis = SynthesisArtifactSchema.safeParse(value);
  if (synthesis.success) return { kind: 'synthesis' as const, artifact: synthesis.data };
  const summary = DriveSummaryJsonSchema.safeParse(value);
  if (summary.success) return { kind: 'summary' as const, artifact: summary.data };
  return null;
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/open-loops');
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
  try { body = RequestSchema.parse(await request.json()); } catch { return respond(jsonError(400, 'invalid_request', 'Invalid request payload.')); }

  const drive = createDriveClient(accessToken);

  let file;
  try {
    file = await withRetry((signal) => withTimeout((timeoutSignal) => drive.files.get({ fileId: body.artifactId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }), DEFAULT_GOOGLE_TIMEOUT_MS, 'upstream_timeout', signal));
  } catch {
    return respond(jsonError(404, 'not_found', 'Artifact not found.'));
  }

  const parsed = parseArtifact(parseDriveJson(file.data));
  if (!parsed) return respond(jsonError(400, 'invalid_request', 'Artifact data was invalid.'));

  const loops = [...(parsed.artifact.openLoops ?? [])];
  let targetIndex = -1;
  if (typeof body.openLoopIndex === 'number') {
    if (body.openLoopIndex >= 0 && body.openLoopIndex < loops.length) targetIndex = body.openLoopIndex;
  } else if (body.openLoopText) {
    const search = normalizeText(body.openLoopText);
    targetIndex = loops.findIndex((loop) => normalizeText(loop.text) === search);
  }

  if (targetIndex < 0) return respond(jsonError(404, 'not_found', 'Open loop not found.'));

  const nowISO = new Date().toISOString();
  const target = { ...loops[targetIndex] };

  if (body.action === 'close') {
    target.status = 'closed';
    target.closedAtISO = nowISO;
    if (typeof body.patch?.closedReason !== 'undefined') target.closedReason = body.patch.closedReason;
    if (typeof body.sourceActionId !== 'undefined') target.sourceActionId = body.sourceActionId;
  } else if (body.action === 'reopen') {
    target.status = 'open';
    target.closedAtISO = null;
    target.closedReason = null;
    target.sourceActionId = null;
  } else if (body.action === 'edit') {
    if (typeof body.patch?.text === 'string') target.text = body.patch.text;
    if (typeof body.patch?.owner !== 'undefined') target.owner = body.patch.owner;
    if (typeof body.patch?.dueDateISO !== 'undefined') target.dueDateISO = body.patch.dueDateISO;
    if ((target.status ?? 'open') === 'closed' && typeof body.patch?.closedReason !== 'undefined') {
      target.closedReason = body.patch.closedReason;
    }
  }

  const validatedTarget = OpenLoopSchema.parse(target);
  loops[targetIndex] = validatedTarget;

  const nextArtifact = parsed.kind === 'summary'
    ? { ...parsed.artifact, openLoops: loops, updatedAtISO: nowISO }
    : { ...parsed.artifact, openLoops: loops };

  try {
    await withRetry((signal) => withTimeout((timeoutSignal) => drive.files.update({ fileId: body.artifactId, media: { mimeType: 'application/json', body: JSON.stringify(nextArtifact, null, 2) } }, { signal: timeoutSignal }), DEFAULT_GOOGLE_TIMEOUT_MS, 'upstream_timeout', signal));
  } catch {
    return respond(jsonError(500, 'upstream_error', 'Unable to persist open loop update.'));
  }

  try {
    const loaded = await loadArtifactIndex(drive, session.driveFolderId, ctx);
    const base = loaded.index.artifacts.find((entry) => entry.driveFileId === body.artifactId);
    if (base) {
      const openLoopsOpenCount = loops.filter((loop) => (loop.status ?? 'open') === 'open').length;
      const next = upsertArtifactIndexEntry(loaded.index, { ...base, openLoopsCount: openLoopsOpenCount, updatedAtISO: nowISO });
      await saveArtifactIndex(drive, session.driveFolderId, loaded.fileId, next, ctx);
    }
  } catch {
    // best effort
  }

  return respond(NextResponse.json({
    ok: true,
    artifactId: body.artifactId,
    updatedOpenLoops: loops,
    openLoopsOpenCount: loops.filter((loop) => (loop.status ?? 'open') === 'open').length,
  }));
};
