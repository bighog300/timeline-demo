import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  SummarizeRequestSchema,
  SummarizeResponseSchema,
  type SummarizeRequest,
  type SummaryArtifact,
} from '@timeline/shared';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchDriveFileText, fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { PayloadLimitError } from '../../../lib/driveSafety';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';
import { hashUserHint, logError, logInfo, logWarn, safeError, time } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { upsertArtifactIndex } from '../../../lib/timeline/artifactIndex';

const MAX_ITEMS = 10;
const PREVIEW_CHARS = 600;


const buildSuggestedActionId = (type: string, text: string, dueDateISO?: string | null) =>
  `act_${createHash('sha256').update(`${type}|${text}|${dueDateISO ?? ''}`).digest('hex').slice(0, 12)}`;

const normalizeSuggestedActionsForArtifact = (
  actions: Array<{ id?: string; type: 'reminder' | 'task' | 'calendar'; text: string; dueDateISO?: string | null; confidence?: number | null }> | undefined,
  nowISO: string,
) =>
  actions?.map((action) => ({
    id: action.id?.trim() || buildSuggestedActionId(action.type, action.text, action.dueDateISO),
    type: action.type,
    text: action.text,
    ...(typeof action.dueDateISO === 'string' ? { dueDateISO: action.dueDateISO } : action.dueDateISO === null ? { dueDateISO: null } : {}),
    ...(typeof action.confidence === 'number' ? { confidence: action.confidence } : action.confidence === null ? { confidence: null } : {}),
    status: 'proposed' as const,
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  }));


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
    const parsed = SummarizeRequestSchema.safeParse(await request.json());
    body = parsed.success ? parsed.data : null;
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  if (!body) {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const items = body.items;

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

  let timelineProvider: Awaited<ReturnType<typeof getTimelineProviderFromDrive>>['provider'];
  let settings: Awaited<ReturnType<typeof getTimelineProviderFromDrive>>['settings'];

  try {
    const providerResult = await getTimelineProviderFromDrive(drive, driveFolderId, ctx);
    timelineProvider = providerResult.provider;
    settings = providerResult.settings;
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'not_configured') {
      return respond(
        jsonError(500, 'provider_not_configured', 'Selected provider is not configured.'),
      );
    }
    throw error;
  }

  const artifacts: SummaryArtifact[] = [];
  const failed: Array<{ source: 'gmail' | 'drive'; id: string; error: string }> = [];

  for (const item of items) {
    try {
      const content =
        item.source === 'gmail'
          ? await fetchGmailMessageText(gmail, item.id, ctx)
          : await fetchDriveFileText(drive, item.id, driveFolderId, ctx);

      const { summary, highlights, evidence, dateConfidence, contentDateISO, model, suggestedActions } = await time(ctx, 'summarize', async () =>
        timelineProvider.summarize(
          {
            title: content.title,
            text: content.text,
            source: item.source,
            sourceMetadata: content.metadata,
          },
          settings,
        ),
      );

      const createdAtISO = new Date().toISOString();
      const normalizedSuggestedActions = normalizeSuggestedActionsForArtifact(suggestedActions, createdAtISO);
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
        ...(contentDateISO ? { contentDateISO } : {}),
        ...(evidence?.length ? { evidence } : {}),
        ...(typeof dateConfidence === 'number' ? { dateConfidence } : {}),
        ...(normalizedSuggestedActions?.length ? { suggestedActions: normalizedSuggestedActions } : {}),
        sourceMetadata: content.metadata,
        sourcePreview,
        driveFolderId,
        driveFileId: '',
        driveWebViewLink: undefined,
        model,
        version: 1,
      };

      const driveResult = await writeArtifactToDrive(drive, driveFolderId, artifact, ctx);

      const persistedArtifact = {
        ...artifact,
        driveFileId: driveResult.jsonFileId,
        driveWebViewLink: driveResult.jsonWebViewLink,
      };

      artifacts.push(persistedArtifact);
      try {
        await upsertArtifactIndex(drive, driveFolderId, persistedArtifact, ctx);
      } catch (indexError) {
        logWarn(ctx, 'artifact_index_upsert_failed', { error: safeError(indexError) });
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === 'bad_output') {
          return respond(jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'));
        }

        if (error.code === 'not_configured') {
          return respond(
            jsonError(500, 'provider_not_configured', 'Selected provider is not configured.'),
          );
        }
      }

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

  const responsePayload = SummarizeResponseSchema.parse({ artifacts, failed });
  return respond(NextResponse.json(responsePayload));
};
