import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchDriveFileText, fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { summarizeDeterministic } from '../../../lib/summarize';
import type { SummaryArtifact } from '../../../lib/types';
import { PayloadLimitError } from '../../../lib/driveSafety';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';

type SummarizeRequest = {
  items: Array<{ source: 'gmail' | 'drive'; id: string }>;
};

type FailedItem = {
  source: 'gmail' | 'drive';
  id: string;
  error: string;
};

const MAX_ITEMS = 10;
const PREVIEW_CHARS = 600;

const isValidItem = (value: unknown): value is { source: 'gmail' | 'drive'; id: string } => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as { source?: string; id?: string };
  return (item.source === 'gmail' || item.source === 'drive') && typeof item.id === 'string';
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/summarize');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 10, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  let body: SummarizeRequest | null = null;
  try {
    body = (await request.json()) as SummarizeRequest;
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const items = Array.isArray(body?.items) ? body.items.filter(isValidItem) : [];

  if (items.length > MAX_ITEMS) {
    return respond(
      jsonError(400, 'too_many_items', 'Too many items requested.', {
        limit: MAX_ITEMS,
      }),
    );
  }

  logInfo(ctx, 'summarize_batch', { items: items.length });

  const gmail = createGmailClient(accessToken);
  const drive = createDriveClient(accessToken);

  const artifacts: SummaryArtifact[] = [];
  const failed: FailedItem[] = [];

  for (const item of items) {
    try {
      const content =
        item.source === 'gmail'
          ? await fetchGmailMessageText(gmail, item.id, ctx)
          : await fetchDriveFileText(drive, item.id, driveFolderId, ctx);

      const { summary, highlights } = await time(ctx, 'summarize', async () =>
        summarizeDeterministic({
          title: content.title,
          text: content.text,
        }),
      );

      const createdAtISO = new Date().toISOString();
      const sourcePreview =
        content.text.length > PREVIEW_CHARS
          ? `${content.text.slice(0, PREVIEW_CHARS).trimEnd()}…`
          : content.text;
      const artifact: SummaryArtifact = {
        artifactId: `${item.source}:${item.id}`,
        source: item.source,
        sourceId: item.id,
        title: content.title,
        createdAtISO,
        summary,
        highlights,
        sourceMetadata: content.metadata,
        sourcePreview,
        driveFolderId,
        driveFileId: '',
        driveWebViewLink: undefined,
        model: 'stub',
        version: 1,
      };

      const driveResult = await writeArtifactToDrive(drive, driveFolderId, artifact, ctx);

      artifacts.push({
        ...artifact,
        driveFileId: driveResult.markdownFileId,
        driveWebViewLink: driveResult.markdownWebViewLink,
      });
    } catch (error) {
      if (error instanceof PayloadLimitError) {
        return respond(
          jsonError(
            400,
            'invalid_request',
            `${error.label} is too large to store in Drive. Trim the selection and try again.`,
          ),
        );
      }
      logError(ctx, 'summarize_item_failed', {
        source: item.source,
        error: safeError(error),
      });
      failed.push({
        source: item.source,
        id: item.id,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return respond(NextResponse.json({ artifacts, failed }));
};
