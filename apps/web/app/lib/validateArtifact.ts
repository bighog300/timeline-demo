import type { SummaryArtifact } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const normalizeString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;

const normalizeSourceMetadata = (value: unknown) => {
  if (!isRecord(value)) {
    return undefined;
  }

  const metadata = {
    from: normalizeString(value.from),
    to: normalizeString(value.to),
    subject: normalizeString(value.subject),
    dateISO: normalizeString(value.dateISO),
    threadId: normalizeString(value.threadId),
    labels: normalizeStringArray(value.labels),
    mimeType: normalizeString(value.mimeType),
    driveName: normalizeString(value.driveName),
    driveModifiedTime: normalizeString(value.driveModifiedTime),
    driveWebViewLink: normalizeString(value.driveWebViewLink),
  };

  return Object.values(metadata).some((entry) => entry !== undefined) ? metadata : undefined;
};

export const isSummaryArtifact = (value: unknown): value is SummaryArtifact => {
  if (!isRecord(value)) {
    return false;
  }

  const source = value.source;
  if (source !== 'gmail' && source !== 'drive') {
    return false;
  }

  return (
    typeof value.artifactId === 'string' &&
    typeof value.sourceId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAtISO === 'string' &&
    typeof value.summary === 'string' &&
    (value.highlights === undefined || isStringArray(value.highlights)) &&
    (value.sourceMetadata === undefined || isRecord(value.sourceMetadata)) &&
    (value.sourcePreview === undefined || typeof value.sourcePreview === 'string') &&
    (value.driveFolderId === undefined || typeof value.driveFolderId === 'string') &&
    (value.driveFileId === undefined || typeof value.driveFileId === 'string') &&
    (value.driveWebViewLink === undefined || typeof value.driveWebViewLink === 'string') &&
    (value.model === undefined || typeof value.model === 'string') &&
    (value.version === undefined || typeof value.version === 'number')
  );
};

export const normalizeArtifact = (artifact: SummaryArtifact): SummaryArtifact => ({
  ...artifact,
  highlights: Array.isArray(artifact.highlights)
    ? artifact.highlights.filter((item) => typeof item === 'string')
    : [],
  sourceMetadata: normalizeSourceMetadata(artifact.sourceMetadata),
  sourcePreview: normalizeString(artifact.sourcePreview),
  model: artifact.model || 'unknown',
  version: Number.isFinite(artifact.version) && artifact.version > 0 ? artifact.version : 1,
  driveFolderId: artifact.driveFolderId || '',
  driveFileId: artifact.driveFileId || '',
});
