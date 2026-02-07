import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleSession } from '../../../lib/googleAuth';
import { hashUserHint, logInfo } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/google/disconnect');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  if (!session) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  return respond(NextResponse.json({ ok: true }));
};
