import {
  ArtifactIndexSchema,
  type ArtifactIndex,
  type ArtifactIndexEntry,
  type SummaryArtifact,
} from '@timeline/shared';
import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../googleRequest';
import type { LogContext } from '../logger';
import { time } from '../logger';

export const ARTIFACT_INDEX_FILENAME = 'artifacts_index.json';
const MAX_RETRIES = 2;

const defaultArtifactIndex = (): ArtifactIndex => ({
  version: 1,
  updatedAtISO: new Date().toISOString(),
  artifacts: [],
});

const parseJson = (data: unknown): unknown => {
  if (typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

const sanitizeArray = (values?: string[]) =>
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, 20);

export const artifactToIndexEntry = (artifact: SummaryArtifact): ArtifactIndexEntry => ({
  id: artifact.artifactId,
  driveFileId: artifact.driveFileId,
  title: artifact.title,
  ...(artifact.contentDateISO ? { contentDateISO: artifact.contentDateISO } : {}),
  tags: sanitizeArray([
    ...(artifact.sourceMetadata?.labels ?? []),
    ...(artifact.sourceMetadata?.mimeType ? [artifact.sourceMetadata.mimeType] : []),
  ]),
  participants: sanitizeArray([
    ...(artifact.sourceMetadata?.from ? [artifact.sourceMetadata.from] : []),
    ...(artifact.sourceMetadata?.to ? [artifact.sourceMetadata.to] : []),
  ]),
  updatedAtISO: artifact.createdAtISO,
});

export const upsertArtifactIndexEntry = (
  index: ArtifactIndex,
  entry: ArtifactIndexEntry,
): ArtifactIndex => {
  const parsedEntry = ArtifactIndexSchema.shape.artifacts.element.parse(entry);
  const deduped = index.artifacts.filter((item) => item.id !== parsedEntry.id);
  return ArtifactIndexSchema.parse({
    version: 1,
    updatedAtISO: new Date().toISOString(),
    artifacts: [...deduped, parsedEntry],
  });
};

export const loadArtifactIndex = async (
  drive: drive_v3.Drive,
  folderId: string,
  ctx?: LogContext,
): Promise<{ index: ArtifactIndex; fileId: string | null }> => {
  const listOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: `'${folderId}' in parents and trashed=false and name='${ARTIFACT_INDEX_FILENAME}'`,
                pageSize: 1,
                fields: 'files(id)',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );

  const listed = ctx ? await time(ctx, 'drive.files.list.artifacts_index', listOperation) : await listOperation();
  const fileId = listed.data.files?.[0]?.id ?? null;
  if (!fileId) {
    const created = await saveArtifactIndex(drive, folderId, null, defaultArtifactIndex(), ctx);
    return { index: created.index, fileId: created.fileId };
  }

  const readOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.get({ fileId, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );

  const response = ctx ? await time(ctx, 'drive.files.get.artifacts_index', readOperation) : await readOperation();
  const parsed = ArtifactIndexSchema.safeParse(parseJson(response.data));
  return {
    index: parsed.success ? parsed.data : defaultArtifactIndex(),
    fileId,
  };
};

export const saveArtifactIndex = async (
  drive: drive_v3.Drive,
  folderId: string,
  fileId: string | null,
  index: ArtifactIndex,
  ctx?: LogContext,
): Promise<{ index: ArtifactIndex; fileId: string }> => {
  const payload = ArtifactIndexSchema.parse({
    ...index,
    version: 1,
    updatedAtISO: new Date().toISOString(),
  });

  if (fileId) {
    const updateOperation = () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.update(
                {
                  fileId,
                  media: { mimeType: 'application/json', body: JSON.stringify(payload, null, 2) },
                  fields: 'id',
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      );
    const updated = ctx ? await time(ctx, 'drive.files.update.artifacts_index', updateOperation) : await updateOperation();
    return { index: payload, fileId: updated.data.id ?? fileId };
  }

  const createOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.create(
              {
                requestBody: { name: ARTIFACT_INDEX_FILENAME, parents: [folderId], mimeType: 'application/json' },
                media: { mimeType: 'application/json', body: JSON.stringify(payload, null, 2) },
                fields: 'id',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const created = ctx ? await time(ctx, 'drive.files.create.artifacts_index', createOperation) : await createOperation();
  return { index: payload, fileId: created.data.id ?? '' };
};

export const upsertArtifactIndex = async (
  drive: drive_v3.Drive,
  folderId: string,
  artifact: SummaryArtifact,
  ctx?: LogContext,
): Promise<void> => {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= MAX_RETRIES) {
    try {
      const loaded = await loadArtifactIndex(drive, folderId, ctx);
      const next = upsertArtifactIndexEntry(loaded.index, artifactToIndexEntry(artifact));
      await saveArtifactIndex(drive, folderId, loaded.fileId, next, ctx);
      return;
    } catch (error) {
      lastError = error;
      attempt += 1;
    }
  }
  throw lastError;
};
