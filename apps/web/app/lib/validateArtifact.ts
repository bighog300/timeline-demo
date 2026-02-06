import type { SummaryArtifact } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

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
    isStringArray(value.highlights) &&
    typeof value.driveFolderId === 'string' &&
    typeof value.driveFileId === 'string' &&
    (value.driveWebViewLink === undefined || typeof value.driveWebViewLink === 'string') &&
    typeof value.model === 'string' &&
    typeof value.version === 'number'
  );
};

export const normalizeArtifact = (artifact: SummaryArtifact): SummaryArtifact => ({
  ...artifact,
  highlights: Array.isArray(artifact.highlights)
    ? artifact.highlights.filter((item) => typeof item === 'string')
    : [],
  model: artifact.model || 'unknown',
  version: Number.isFinite(artifact.version) && artifact.version > 0 ? artifact.version : 1,
});
