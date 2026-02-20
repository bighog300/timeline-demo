import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../googleRequest';
import type { LogContext } from '../logger';
import { time } from '../logger';
import { loadArtifactIndex } from './artifactIndex';
import type { SummaryArtifact } from '../types';
import { isSummaryArtifact, normalizeArtifact } from '../validateArtifact';

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
};

const readArtifactByFileId = async (
  drive: drive_v3.Drive,
  fileId: string,
  ctx?: LogContext,
): Promise<SummaryArtifact | null> => {
  const operation = () =>
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

  const response = ctx ? await time(ctx, 'drive.files.get.media.export', operation) : await operation();
  const parsed = parseDriveJson(response.data);
  if (!isSummaryArtifact(parsed)) {
    return null;
  }
  const normalized = normalizeArtifact(parsed);
  return {
    ...normalized,
    driveFileId: normalized.driveFileId || fileId,
  };
};

export const loadArtifactsForExport = async ({
  drive,
  folderId,
  artifactIds,
  ctx,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  artifactIds?: string[];
  ctx?: LogContext;
}): Promise<SummaryArtifact[]> => {
  const { index } = await loadArtifactIndex(drive, folderId, ctx);
  const selectedIds = artifactIds?.length
    ? new Set(artifactIds.map((id) => id.trim()).filter(Boolean))
    : null;

  const fileIds = index.artifacts
    .map((item) => item.driveFileId)
    .filter((value): value is string => Boolean(value) && (!selectedIds || selectedIds.has(value)));

  const uniqueFileIds = Array.from(new Set(fileIds));
  if (selectedIds) {
    selectedIds.forEach((id) => {
      if (!uniqueFileIds.includes(id)) uniqueFileIds.push(id);
    });
  }
  const artifacts = await Promise.all(uniqueFileIds.map((fileId) => readArtifactByFileId(drive, fileId, ctx)));
  return artifacts.filter((value): value is SummaryArtifact => Boolean(value));
};
