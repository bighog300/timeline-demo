import type { SummaryArtifact } from './types';

export const artifactKey = (source: 'gmail' | 'drive', id: string) => `${source}:${id}`;

export const mergeArtifacts = (
  existing: Record<string, SummaryArtifact>,
  updates: SummaryArtifact[],
  limit: number,
): Record<string, SummaryArtifact> => {
  const next = { ...existing };

  updates.forEach((artifact) => {
    next[artifactKey(artifact.source, artifact.sourceId)] = artifact;
  });

  const entries = Object.entries(next);
  if (entries.length <= limit) {
    return next;
  }

  entries.sort((a, b) => {
    const aTime = Date.parse(a[1].createdAtISO || '') || 0;
    const bTime = Date.parse(b[1].createdAtISO || '') || 0;
    return bTime - aTime;
  });

  return Object.fromEntries(entries.slice(0, limit));
};
