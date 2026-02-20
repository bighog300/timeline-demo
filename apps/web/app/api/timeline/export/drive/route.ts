import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { hashUserHint, logInfo } from '../../../../lib/logger';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../../lib/requestContext';
import { createTimelineDriveDoc } from '../../../../lib/timeline/driveDoc';
import { buildTimelineExportModel } from '../../../../lib/timeline/exportBuilder';
import { loadArtifactsForExport } from '../../../../lib/timeline/exportArtifacts';

const BodySchema = z
  .object({
    artifactIds: z.array(z.string().trim().min(1)).max(500).optional(),
  })
  .strict();

export const runtime = 'nodejs';

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/export/drive');
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

  const rate = checkRateLimit(getRateLimitKey(request, session), { limit: 20, windowMs: 60_000 }, ctx);
  if (!rate.allowed) return respond(jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.'));

  let body;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);
  const artifacts = await loadArtifactsForExport({
    drive,
    folderId: session.driveFolderId,
    artifactIds: body.artifactIds,
    ctx,
  });

  if (!artifacts.length) {
    return respond(jsonError(400, 'invalid_request', 'No artifacts available for export.'));
  }

  const model = buildTimelineExportModel(
    artifacts.map((artifact) => ({ entryKey: artifact.artifactId, artifact })),
  );
  const created = await createTimelineDriveDoc({
    drive,
    accessToken,
    folderId: session.driveFolderId,
    model,
    ctx,
  });

  return respond(NextResponse.json(created));
};
