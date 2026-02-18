import { NextResponse, type NextRequest } from 'next/server';
import { DriveSummaryJsonSchema, SummaryArtifactSchema } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { findIndexFile, readIndexFile, writeIndexFile } from '../../../../lib/indexDrive';
import { extractContentDate } from '../../../../lib/llm/contentDateExtraction';
import { ProviderError } from '../../../../lib/llm/providerErrors';
import { getTimelineProviderFromDrive } from '../../../../lib/llm/providerRouter';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const FALLBACK_LIST_CAP = 200;

const BodySchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    dryRun: z.boolean().default(false),
  })
  .strict();

const CandidateSchema = z
  .object({
    fileId: z.string(),
    title: z.string(),
  })
  .strict();

const ItemSchema = z
  .object({
    fileId: z.string(),
    title: z.string(),
    before: z.string().nullable(),
    after: z.string().nullable(),
    status: z.enum(['updated', 'skipped', 'no_date']),
  })
  .strict();

const ResponseSchema = z
  .object({
    dryRun: z.boolean(),
    limit: z.number().int().min(1).max(MAX_LIMIT),
    scanned: z.number().int().min(0),
    updated: z.number().int().min(0),
    skippedAlreadyHasDate: z.number().int().min(0),
    noDateFound: z.number().int().min(0),
    items: z.array(ItemSchema),
  })
  .strict();

const parseRequestBody = async (request: NextRequest) => {
  const parsed = await request.json().catch(() => null);
  return BodySchema.safeParse(parsed);
};

const listFallbackCandidates = async (drive: ReturnType<typeof createDriveClient>, folderId: string) => {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name contains 'Summary.json'`,
    pageSize: FALLBACK_LIST_CAP,
    orderBy: 'modifiedTime desc',
    fields: 'files(id, name)',
  });

  return (response.data.files ?? [])
    .filter((file): file is { id: string; name: string } => Boolean(file.id && file.name))
    .map((file) => ({ fileId: file.id, title: file.name }));
};

export const POST = async (request: NextRequest) => {
  const bodyResult = await parseRequestBody(request);
  if (!bodyResult.success) {
    return jsonError(400, 'bad_request', 'Invalid request payload.');
  }

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();
  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const drive = createDriveClient(accessToken);

  let settings: Awaited<ReturnType<typeof getTimelineProviderFromDrive>>['settings'];
  try {
    const providerResult = await getTimelineProviderFromDrive(drive, driveFolderId);
    settings = providerResult.settings;
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'not_configured') {
      return jsonError(500, 'provider_not_configured', 'Selected provider is not configured.');
    }
    return jsonError(500, 'internal_error', 'Failed to load provider settings.');
  }

  const { limit, dryRun } = bodyResult.data;

  const indexFile = await findIndexFile(drive, driveFolderId);
  const timelineIndex = indexFile?.id ? await readIndexFile(drive, indexFile.id, driveFolderId) : null;

  const candidates = timelineIndex
    ? timelineIndex.summaries.map((entry) => ({ fileId: entry.driveFileId, title: entry.title }))
    : await listFallbackCandidates(drive, driveFolderId);

  const candidateList = candidates.slice(0, limit).map((item) => CandidateSchema.parse(item));

  let updated = 0;
  let skippedAlreadyHasDate = 0;
  let noDateFound = 0;
  const items: z.infer<typeof ItemSchema>[] = [];

  for (const candidate of candidateList) {
    const fileMetaResponse = await drive.files.get({ fileId: candidate.fileId, fields: 'id, parents, name' });
    const inFolder = (fileMetaResponse.data.parents ?? []).includes(driveFolderId);
    if (!inFolder) {
      continue;
    }

    const fileResponse = await drive.files.get({ fileId: candidate.fileId, alt: 'media' }, { responseType: 'json' });
    const parsed = DriveSummaryJsonSchema.safeParse(fileResponse.data);
    if (!parsed.success) {
      continue;
    }

    const summaryJson = parsed.data;
    if (summaryJson.contentDateISO) {
      skippedAlreadyHasDate += 1;
      items.push({
        fileId: candidate.fileId,
        title: summaryJson.title,
        before: summaryJson.contentDateISO,
        after: summaryJson.contentDateISO,
        status: 'skipped',
      });
      continue;
    }

    let extracted: { contentDateISO?: string };
    try {
      extracted = await extractContentDate(
        {
          title: summaryJson.title,
          summary: summaryJson.summary,
          highlights: summaryJson.highlights,
          source: summaryJson.source,
          sourceMetadata: summaryJson.sourceMetadata,
        },
        settings,
      );
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'not_configured') {
        return jsonError(500, 'provider_not_configured', 'Selected provider is not configured.');
      }
      if (error instanceof ProviderError && error.code === 'bad_output') {
        return jsonError(502, 'provider_bad_output', 'Provider returned invalid output.');
      }
      return jsonError(500, 'internal_error', 'Failed to extract content dates.');
    }

    if (!extracted.contentDateISO) {
      noDateFound += 1;
      items.push({
        fileId: candidate.fileId,
        title: summaryJson.title,
        before: null,
        after: null,
        status: 'no_date',
      });
      continue;
    }

    const nextUpdatedAtISO = new Date().toISOString();
    const nextSummaryJson = DriveSummaryJsonSchema.parse({
      ...summaryJson,
      updatedAtISO: nextUpdatedAtISO,
      contentDateISO: extracted.contentDateISO,
    });
    SummaryArtifactSchema.parse({
      artifactId: nextSummaryJson.artifactId,
      source: nextSummaryJson.source,
      sourceId: nextSummaryJson.sourceId,
      title: nextSummaryJson.title,
      createdAtISO: nextSummaryJson.createdAtISO,
      contentDateISO: nextSummaryJson.contentDateISO,
      summary: nextSummaryJson.summary,
      highlights: nextSummaryJson.highlights,
      sourceMetadata: nextSummaryJson.sourceMetadata,
      sourcePreview: nextSummaryJson.sourcePreview,
      driveFolderId: nextSummaryJson.driveFolderId,
      driveFileId: nextSummaryJson.driveFileId,
      driveWebViewLink: nextSummaryJson.driveWebViewLink,
      model: nextSummaryJson.model,
      version: nextSummaryJson.version,
    });

    if (!dryRun) {
      await drive.files.update({
        fileId: candidate.fileId,
        media: {
          mimeType: 'application/json',
          body: JSON.stringify(nextSummaryJson, null, 2),
        },
        fields: 'id',
      });

      if (timelineIndex && indexFile?.id) {
        const summaryEntry = timelineIndex.summaries.find((entry) => entry.driveFileId === candidate.fileId);
        if (summaryEntry) {
          summaryEntry.updatedAtISO = nextUpdatedAtISO;
        }
      }
    }

    updated += 1;
    items.push({
      fileId: candidate.fileId,
      title: summaryJson.title,
      before: null,
      after: extracted.contentDateISO,
      status: 'updated',
    });
  }

  if (!dryRun && timelineIndex && indexFile?.id) {
    await writeIndexFile(drive, driveFolderId, indexFile.id, timelineIndex);
  }

  const payload = ResponseSchema.parse({
    dryRun,
    limit,
    scanned: candidateList.length,
    updated,
    skippedAlreadyHasDate,
    noDateFound,
    items,
  });

  return NextResponse.json(payload);
};
