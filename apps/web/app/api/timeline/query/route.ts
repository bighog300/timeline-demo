import { NextResponse, type NextRequest } from 'next/server';
import { StructuredQueryRequestSchema } from '@timeline/shared';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { hashUserHint, logInfo } from '../../../lib/logger';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { readEntityAliasesFromDrive } from '../../../lib/entities/aliases';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';
import { runStructuredQuery } from '../../../lib/timeline/structuredQuery';

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/query');
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

  let body: unknown;
  try {
    body = await request.json();
    StructuredQueryRequestSchema.parse(body);
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);
  const loaded = await loadArtifactIndex(drive, session.driveFolderId, ctx);
  let aliasConfig;
  try {
    aliasConfig = await readEntityAliasesFromDrive(drive, session.driveFolderId, ctx);
  } catch {
    aliasConfig = undefined;
  }

  const payload = await runStructuredQuery({
    drive,
    index: loaded.index,
    input: body,
    ...(aliasConfig ? { aliases: aliasConfig.aliases } : {}),
  });
  return respond(NextResponse.json(payload));
};
