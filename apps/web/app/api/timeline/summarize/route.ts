import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  SummarizeRequestSchema,
  SummarizeResponseSchema,
  type SummarizeRequest,
  type SummaryArtifact,
  type UrlSelection,
} from '@timeline/shared';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchDriveFileText, fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../../../lib/googleRequest';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { PayloadLimitError } from '../../../lib/driveSafety';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';
import { hashUserHint, logError, logInfo, logWarn, safeError, time, type LogContext } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';
import { upsertArtifactIndex } from '../../../lib/timeline/artifactIndex';
import { canonicalizeEntities, readEntityAliasesFromDrive } from '../../../lib/entities/aliases';

const MAX_ITEMS = 10;
const PREVIEW_CHARS = 600;

type SummarizeItem = SummarizeRequest['items'][number];

const isUrlSelection = (item: SummarizeItem): item is UrlSelection => 'kind' in item && item.kind === 'url';

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

const parseJsonPayload = (data: unknown) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
};

const parseDateISO = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const readUrlMetadata = async (drive: ReturnType<typeof createDriveClient>, item: UrlSelection) => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get({ fileId: item.driveMetaFileId, alt: 'media' }, { responseType: 'text', signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const payload = parseJsonPayload(response.data);
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const record = payload as Record<string, unknown>;
  return {
    url: typeof record.url === 'string' ? record.url : item.url,
    finalUrl: typeof record.finalUrl === 'string' ? record.finalUrl : undefined,
    fetchedAtISO: parseDateISO(record.fetchedAtISO),
    contentType: typeof record.contentType === 'string' ? record.contentType : undefined,
    dateISO: parseDateISO(record.fetchedAtISO),
    title: typeof record.title === 'string' ? record.title : item.title,
  };
};

const resolveSourceContent = async (
  drive: ReturnType<typeof createDriveClient>,
  gmail: ReturnType<typeof createGmailClient>,
  item: SummarizeItem,
  driveFolderId: string,
) => {
  if (isUrlSelection(item)) {
    const content = await fetchDriveFileText(drive, item.driveTextFileId, driveFolderId);
    const urlMeta = await readUrlMetadata(drive, item);
    return {
      source: 'drive' as const,
      sourceId: item.driveTextFileId,
      title: item.title ?? urlMeta.title ?? content.title,
      text: content.text,
      metadata: {
        ...content.metadata,
        url: urlMeta.url,
        finalUrl: urlMeta.finalUrl,
        fetchedAtISO: urlMeta.fetchedAtISO,
        dateISO: content.metadata?.dateISO ?? urlMeta.dateISO,
        driveMetaFileId: item.driveMetaFileId,
      },
    };
  }

  const sourceItem = item as Exclude<SummarizeItem, UrlSelection>;
  const content =
    sourceItem.source === 'gmail'
      ? await fetchGmailMessageText(gmail, sourceItem.id)
      : await fetchDriveFileText(drive, sourceItem.id, driveFolderId);

  return {
    source: sourceItem.source,
    sourceId: sourceItem.id,
    title: content.title,
    text: content.text,
    metadata: content.metadata,
  };
};

export const summarizeTimelineItems = async (
  params: {
    items: SummarizeRequest['items'];
    session: NonNullable<Awaited<ReturnType<typeof getGoogleSession>>>;
    accessToken: string;
    ctx: LogContext;
  },
) : Promise<{ payload: ReturnType<typeof SummarizeResponseSchema.parse>; response?: never } | { response: NextResponse; payload?: never }> => {
  const { items, session, accessToken, ctx } = params;
  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return { response: jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.') };
  }

  if (items.length > MAX_ITEMS) {
    return {
      response: jsonError(400, 'too_many_items', 'Too many items requested.', { limit: MAX_ITEMS }),
    };
  }

  logInfo(ctx, 'summarize_batch', { items: items.length });

  const gmail = createGmailClient(accessToken);
  const drive = createDriveClient(accessToken);
  let aliasConfig = { version: 1 as const, updatedAtISO: new Date().toISOString(), aliases: [] as never[] };
  try {
    aliasConfig = (await readEntityAliasesFromDrive(drive, driveFolderId, ctx)).aliases as typeof aliasConfig;
  } catch {
    // alias loading is best-effort
  }

  let timelineProvider: Awaited<ReturnType<typeof getTimelineProviderFromDrive>>['provider'];
  let settings: Awaited<ReturnType<typeof getTimelineProviderFromDrive>>['settings'];

  try {
    const providerResult = await getTimelineProviderFromDrive(drive, driveFolderId, ctx);
    timelineProvider = providerResult.provider;
    settings = providerResult.settings;
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'not_configured') {
      return {
        response: jsonError(500, 'provider_not_configured', 'Selected provider is not configured.'),
      };
    }
    throw error;
  }

  const artifacts: SummaryArtifact[] = [];
  const failed: Array<{ source: 'gmail' | 'drive'; id: string; error: string }> = [];

  for (const item of items) {
    try {
      const resolved = await resolveSourceContent(drive, gmail, item, driveFolderId);

      const { summary, highlights, evidence, dateConfidence, contentDateISO, model, suggestedActions, entities, decisions, openLoops, risks, participants, tags, topics } = await time(ctx, 'summarize', async () =>
        timelineProvider.summarize(
          {
            title: resolved.title,
            text: resolved.text,
            source: resolved.source,
            sourceMetadata: resolved.metadata,
          },
          settings,
        ),
      );

      const createdAtISO = new Date().toISOString();
      const canonicalEntities = canonicalizeEntities(entities, aliasConfig);
      const normalizedSuggestedActions = normalizeSuggestedActionsForArtifact(suggestedActions, createdAtISO);
      const sourcePreview =
        resolved.text.length > PREVIEW_CHARS
          ? `${resolved.text.slice(0, PREVIEW_CHARS).trimEnd()}…`
          : resolved.text;
      const artifact: SummaryArtifact = {
        artifactId: `${resolved.source}:${resolved.sourceId}`,
        source: resolved.source,
        sourceId: resolved.sourceId,
        title: resolved.title,
        createdAtISO,
        summary,
        highlights,
        ...(contentDateISO ? { contentDateISO } : {}),
        ...(evidence?.length ? { evidence } : {}),
        ...(typeof dateConfidence === 'number' ? { dateConfidence } : {}),
        ...(normalizedSuggestedActions?.length ? { suggestedActions: normalizedSuggestedActions } : {}),
        ...(canonicalEntities.length ? { entities: canonicalEntities } : {}),
        ...(decisions?.length ? { decisions } : {}),
        ...(openLoops?.length ? { openLoops } : {}),
        ...(risks?.length ? { risks } : {}),
        ...(participants?.length ? { participants } : {}),
        ...(tags?.length ? { tags } : {}),
        ...(topics?.length ? { topics } : {}),
        sourceMetadata: resolved.metadata,
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
          return {
            response: jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'),
          };
        }

        if (error.code === 'not_configured') {
          return {
            response: jsonError(500, 'provider_not_configured', 'Selected provider is not configured.'),
          };
        }
      }

      if (error instanceof PayloadLimitError) {
        return {
          response: jsonError(
            400,
            'invalid_request',
            `${error.label} is too large to store in Drive. Trim the selection and try again.`,
          ),
        };
      }

      const failedSource = isUrlSelection(item) ? 'drive' : item.source;
      const failedId = isUrlSelection(item) ? item.driveTextFileId : item.id;
      logError(ctx, 'summarize_item_failed', {
        source: failedSource,
        error: safeError(error),
      });
      failed.push({
        source: failedSource,
        id: failedId,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return { payload: SummarizeResponseSchema.parse({ artifacts, failed }) };
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

  const result = await summarizeTimelineItems({
    items: body.items,
    session,
    accessToken,
    ctx,
  });

  if (result.response) {
    return respond(result.response);
  }

  return respond(NextResponse.json(result.payload));
};
