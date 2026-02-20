import type { TimelineArtifact } from './exportBuilder';
import { groupTimelineArtifacts } from './exportBuilder';

export const getUndatedArtifacts = (artifacts: TimelineArtifact[]): TimelineArtifact[] => {
  const undatedGroup = groupTimelineArtifacts(artifacts).find((group) => group.key === 'undated');
  return undatedGroup ? [...undatedGroup.artifacts] : [];
};

export const summarizeDateCoverage = (artifacts: TimelineArtifact[]) => {
  const undated = getUndatedArtifacts(artifacts).length;
  const total = artifacts.length;
  return {
    total,
    undated,
    dated: Math.max(0, total - undated),
  };
};
