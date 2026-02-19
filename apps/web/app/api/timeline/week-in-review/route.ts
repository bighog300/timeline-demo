import { NextResponse, type NextRequest } from 'next/server';
import { SynthesisRequestSchema, isoDateString } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { hashUserHint, logInfo } from '../../../lib/logger';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { loadArtifactIndex } from '../../../lib/timeline/artifactIndex';
import { runStructuredQuery } from '../../../lib/timeline/structuredQuery';
import { POST as synthesizePost } from '../synthesize/route';
import { renderMarkdownReport } from '../../../lib/reports/renderMarkdownReport';
import { saveReportToDrive } from '../../../lib/reports/saveReportToDrive';

const RequestSchema = z.object({
  dateFromISO: isoDateString.optional(),
  dateToISO: isoDateString.optional(),
  includeEvidence: z.boolean().default(false),
  saveToTimeline: z.boolean().default(true),
  exportReport: z.boolean().default(true),
}).strict();

const dayRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { dateFromISO: from.toISOString(), dateToISO: to.toISOString() };
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/week-in-review');
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

  const rate = checkRateLimit(getRateLimitKey(request, session), { limit: 10, windowMs: 60_000 }, ctx);
  if (!rate.allowed) return respond(jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.'));

  let body;
  try { body = RequestSchema.parse(await request.json()); } catch { return respond(jsonError(400, 'invalid_request', 'Invalid request payload.')); }

  const defaults = dayRange();
  const dateFromISO = body.dateFromISO ?? defaults.dateFromISO;
  const dateToISO = body.dateToISO ?? defaults.dateToISO;

  const synthRequest = SynthesisRequestSchema.parse({
    mode: 'briefing',
    dateFromISO,
    dateToISO,
    includeEvidence: body.includeEvidence,
    saveToTimeline: body.saveToTimeline,
    limit: 15,
  });

  const synthResponse = await synthesizePost(new Request('http://localhost/api/timeline/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(synthRequest),
  }) as never);
  const synthesisPayload = await synthResponse.json();
  if (!synthResponse.ok) return respond(NextResponse.json(synthesisPayload, { status: synthResponse.status }));

  const drive = createDriveClient(accessToken);
  const loaded = await loadArtifactIndex(drive, session.driveFolderId, ctx);
  const queryResult = await runStructuredQuery({
    drive,
    index: loaded.index,
    input: { dateFromISO, dateToISO, kind: ['summary', 'synthesis'], limitArtifacts: 30, limitItemsPerArtifact: 10 },
  });

  let report;
  if (body.exportReport) {
    const title = `Week in Review — ${dateFromISO.slice(0, 10)} to ${dateToISO.slice(0, 10)}`;
    const markdown = renderMarkdownReport({
      title,
      generatedAtISO: new Date().toISOString(),
      query: queryResult.query,
      results: queryResult.results,
      includeCitations: true,
      synthesisContent: synthesisPayload.synthesis?.content,
    });
    report = await saveReportToDrive({ drive, folderId: session.driveFolderId, title, markdown });
  }

  return respond(NextResponse.json({
    ok: true,
    dateFromISO,
    dateToISO,
    synthesis: {
      synthesis: synthesisPayload.synthesis,
      citations: synthesisPayload.citations,
      savedArtifactId: synthesisPayload.savedArtifactId,
    },
    ...(report ? { report } : {}),
    drilldowns: {
      dashboardUrl: '/timeline/dashboard',
      openLoopsUrl: `/timeline?hasOpenLoops=1&dateFromISO=${encodeURIComponent(dateFromISO)}&dateToISO=${encodeURIComponent(dateToISO)}`,
      highRisksUrl: `/timeline?hasRisks=1&riskSeverity=high&dateFromISO=${encodeURIComponent(dateFromISO)}&dateToISO=${encodeURIComponent(dateToISO)}`,
    },
  }));
};
