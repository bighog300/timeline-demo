import type { TimelineArtifact } from './exportBuilder';
import { extractEntityStrings } from './entities';
import { getUndatedArtifacts } from './quality';
import { amountRegex } from './conflicts';

export type MissingInfoResult = {
  missingEntitiesIds: string[];
  missingLocationIds: string[];
  missingAmountIds: string[];
  missingDateIds: string[];
};

const hasStructuredEntities = (artifact: TimelineArtifact['artifact']) =>
  Array.isArray(artifact.entities) && artifact.entities.length > 0;

const hasAmountPattern = (artifact: TimelineArtifact['artifact']) => {
  const text = `${artifact.title} ${artifact.summary}`;
  const matched = amountRegex.test(text);
  amountRegex.lastIndex = 0;
  return matched;
};

export const computeMissingInfo = (artifacts: TimelineArtifact[]): MissingInfoResult => {
  const missingEntitiesIds: string[] = [];
  const missingLocationIds: string[] = [];
  const missingAmountIds: string[] = [];
  const missingDateIds = getUndatedArtifacts(artifacts).map((item) => item.artifact.driveFileId);

  artifacts.forEach((item) => {
    const artifact = item.artifact;
    const user = artifact.userAnnotations;
    const id = artifact.driveFileId;

    const extractedEntities = extractEntityStrings(item);
    if (!hasStructuredEntities(artifact) && !(user?.entities?.length) && extractedEntities.length === 0) {
      missingEntitiesIds.push(id);
    }

    if (!user?.location?.trim()) {
      missingLocationIds.push(id);
    }

    if (!user?.amount?.trim() && !hasAmountPattern(artifact)) {
      missingAmountIds.push(id);
    }
  });

  return { missingEntitiesIds, missingLocationIds, missingAmountIds, missingDateIds };
};

export const getArtifactsByIds = (artifacts: TimelineArtifact[], ids: string[]) => {
  const idSet = new Set(ids);
  return artifacts.filter((item) => idSet.has(item.artifact.driveFileId));
};
