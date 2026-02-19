import { NextResponse, type NextRequest } from 'next/server';
import { ReportExportRequestSchema, ReportExportResponseSchema } from '@timeline/shared';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { hashUserHint, logInfo } from '../../../../lib/logger';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import { createCtx, withRequestId } from '../../../../lib/requestContext';
import { loadArtifactIndex } from '../../../../lib/timeline/artifactIndex';
import { runStructuredQuery } from '../../../../lib/timeline/structuredQuery';
import { renderMarkdownReport } from '../../../../lib/reports/renderMarkdownReport';
import { saveReportToDrive } from '../../../../lib/reports/saveReportToDrive';

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/reports/export');
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
    body = ReportExportRequestSchema.parse(await request.json());
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const drive = createDriveClient(accessToken);
  const loaded = await loadArtifactIndex(drive, session.driveFolderId, ctx);
  const queryInput = body.query ?? (body.weekInReview ? {
    dateFromISO: body.weekInReview.dateFromISO,
    dateToISO: body.weekInReview.dateToISO,
    kind: ['summary', 'synthesis'],
  } : { limitArtifacts: 30, limitItemsPerArtifact: 10 });

  const queryResult = await runStructuredQuery({ drive, index: loaded.index, input: queryInput });
  const createdAtISO = new Date().toISOString();
  const markdown = renderMarkdownReport({
    title: body.title,
    generatedAtISO: createdAtISO,
    query: queryResult.query,
    results: queryResult.results,
    includeCitations: body.includeCitations,
  });

  let driveFileId: string | undefined;
  let driveFileName: string | undefined;
  if (body.saveToDrive) {
    const saved = await saveReportToDrive({ drive, folderId: session.driveFolderId, title: body.title, markdown });
    driveFileId = saved.driveFileId ?? undefined;
    driveFileName = saved.driveFileName;
  }

  return respond(NextResponse.json(ReportExportResponseSchema.parse({
    ok: true,
    report: {
      reportId: `report_${Date.now()}`,
      title: body.title,
      createdAtISO,
      ...(driveFileId ? { driveFileId } : {}),
      ...(driveFileName ? { driveFileName } : {}),
    },
  })));
};
