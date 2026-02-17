import { NextResponse, type NextRequest } from 'next/server';
import {
  DriveSelectionSetJsonSchema,
  DriveSummaryJsonSchema,
  SummaryArtifactSchema,
  type SummaryArtifact,
} from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchDriveFileText, fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { findIndexFile, readIndexFile, writeIndexFile } from '../../../lib/indexDrive';
import { normalizeTimelineIndex } from '../../../lib/validateIndex';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../lib/logger';
import { createCtx, withRequestId } from '../../../lib/requestContext';
import { PayloadLimitError } from '../../../lib/driveSafety';
import { ProviderError } from '../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../lib/llm/providerRouter';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const PREVIEW_CHARS = 600;
const SUMMARY_SUFFIX = ' - Summary.json';
const FALLBACK_LIST_CAP = 200;

const BodySchema = z
  .object({
    selectionSetId: z.string().min(1),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    sourceFilter: z.enum(['all', 'gmail', 'drive']).optional().default('all'),
  })
  .strict();

const ResponseSchema = z
  .object({
    selectionSetId: z.string(),
    requested: z.number().int().min(0),
    summarized: z.number().int().min(0),
    skippedAlreadySummarized: z.number().int().min(0),
    failed: z.array(
      z.object({ source: z.enum(['gmail', 'drive']), id: z.string(), error: z.string() }).strict(),
    ),
    artifacts: z.array(SummaryArtifactSchema),
  })
  .strict();

const sourceAllowed = (source: 'gmail' | 'drive', filter: 'all' | 'gmail' | 'drive') =>
  filter === 'all' || source === filter;

const parseSummary = (value: unknown) => {
  const parsed = DriveSummaryJsonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const listRecentSummaryIds = async (drive: ReturnType<typeof createDriveClient>, folderId: string) => {
  const listResponse = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name contains '${SUMMARY_SUFFIX}'`,
    orderBy: 'modifiedTime desc',
    pageSize: FALLBACK_LIST_CAP,
    fields: 'files(id)',
  });
  return (listResponse.data.files ?? []).flatMap((file) => (file.id ? [file.id] : []));
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/timeline/summarize-missing');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

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

  const bodyResult = BodySchema.safeParse(await request.json().catch(() => null));
  if (!bodyResult.success) {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const body = bodyResult.data;
  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const drive = createDriveClient(accessToken);
  const gmail = createGmailClient(accessToken);

  let selection: z.infer<typeof DriveSelectionSetJsonSchema>;
  try {
    const selectionResponse = await drive.files.get(
      { fileId: body.selectionSetId, alt: 'media' },
      { responseType: 'json' },
    );
    const selectionParsed = DriveSelectionSetJsonSchema.safeParse(selectionResponse.data);
    if (!selectionParsed.success) {
      return respond(jsonError(400, 'invalid_request', 'Selection set payload is invalid.'));
    }
    selection = selectionParsed.data;
  } catch (error) {
    const status = (error as { code?: number }).code;
    if (status === 404) {
      return respond(jsonError(404, 'not_found', 'Selection set not found.'));
    }
    return respond(jsonError(500, 'internal_error', 'Failed to load selection set.'));
  }

  const indexFile = await findIndexFile(drive, driveFolderId);
  const index = indexFile?.id ? await readIndexFile(drive, indexFile.id, driveFolderId) : null;

  const summaryKeys = new Set<string>();
  if (index) {
    for (const summary of index.summaries) {
      summaryKeys.add(`${summary.source}:${summary.sourceId}`);
    }
  } else {
    const ids = await listRecentSummaryIds(drive, driveFolderId);
    const summaries = (
      await Promise.all(
        ids.map(async (id) => {
          const response = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'json' });
          return parseSummary(response.data);
        }),
      )
    ).filter((item): item is NonNullable<ReturnType<typeof parseSummary>> => item !== null);

    for (const summary of summaries) {
      summaryKeys.add(`${summary.source}:${summary.sourceId}`);
    }
  }

  const filteredItems = selection.items.filter((item) => sourceAllowed(item.source, body.sourceFilter));
  const missingItems = filteredItems.filter((item) => !summaryKeys.has(`${item.source}:${item.id}`));
  const requestedItems = missingItems.slice(0, limit);

  let timelineProvider: Awaited<ReturnType<typeof getTimelineProviderFromDrive>>['provider'];
  let settings: Awaited<ReturnType<typeof getTimelineProviderFromDrive>>['settings'];
  try {
    const providerResult = await getTimelineProviderFromDrive(drive, driveFolderId, ctx);
    timelineProvider = providerResult.provider;
    settings = providerResult.settings;
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'not_configured') {
      return respond(jsonError(500, 'provider_not_configured', 'Selected provider is not configured.'));
    }
    return respond(jsonError(500, 'internal_error', 'Failed to load provider settings.'));
  }

  const artifacts: SummaryArtifact[] = [];
  const failed: Array<{ source: 'gmail' | 'drive'; id: string; error: string }> = [];

  for (const item of requestedItems) {
    try {
      const content =
        item.source === 'gmail'
          ? await fetchGmailMessageText(gmail, item.id, ctx)
          : await fetchDriveFileText(drive, item.id, driveFolderId, ctx);

      const { summary, highlights, model } = await time(ctx, 'summarize', async () =>
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
        model,
        version: 1,
      };

      const driveResult = await writeArtifactToDrive(drive, driveFolderId, artifact, ctx);
      artifacts.push({ ...artifact, driveFileId: driveResult.jsonFileId, driveWebViewLink: driveResult.jsonWebViewLink });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'bad_output') {
        return respond(jsonError(502, 'provider_bad_output', 'Provider returned invalid output.'));
      }

      if (error instanceof ProviderError && error.code === 'not_configured') {
        return respond(jsonError(500, 'provider_not_configured', 'Selected provider is not configured.'));
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

      logError(ctx, 'summarize_missing_item_failed', { error: safeError(error), source: item.source, id: item.id });
      failed.push({
        source: item.source,
        id: item.id,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  if (indexFile?.id && artifacts.length > 0) {
    const current = index ?? normalizeTimelineIndex({
      version: 1,
      updatedAtISO: new Date().toISOString(),
      driveFolderId,
      indexFileId: indexFile.id,
      summaries: [],
      selectionSets: [],
      stats: { totalSummaries: 0, totalSelectionSets: 0 },
    }, driveFolderId, indexFile.id);

    const nextSummaries = [...current.summaries];
    for (const artifact of artifacts) {
      const key = `${artifact.source}:${artifact.sourceId}`;
      const existingIndex = nextSummaries.findIndex((entry) => `${entry.source}:${entry.sourceId}` === key);
      const nextEntry = {
        driveFileId: artifact.driveFileId,
        title: artifact.title,
        source: artifact.source,
        sourceId: artifact.sourceId,
        createdAtISO: artifact.createdAtISO,
        updatedAtISO: artifact.createdAtISO,
        webViewLink: artifact.driveWebViewLink,
      };
      if (existingIndex >= 0) {
        nextSummaries[existingIndex] = nextEntry;
      } else {
        nextSummaries.push(nextEntry);
      }
    }

    const selectionSets = current.selectionSets ?? [];
    const nextIndex = normalizeTimelineIndex(
      {
        ...current,
        selectionSets,
        updatedAtISO: new Date().toISOString(),
        summaries: nextSummaries,
        stats: {
          totalSummaries: nextSummaries.length,
          totalSelectionSets: selectionSets.length,
        },
      },
      driveFolderId,
      indexFile.id,
    );

    await writeIndexFile(drive, driveFolderId, indexFile.id, nextIndex, ctx);
  }

  const payload = ResponseSchema.parse({
    selectionSetId: body.selectionSetId,
    requested: requestedItems.length,
    summarized: artifacts.length,
    skippedAlreadySummarized: filteredItems.length - missingItems.length,
    failed,
    artifacts,
  });

  return respond(NextResponse.json(payload));
};
