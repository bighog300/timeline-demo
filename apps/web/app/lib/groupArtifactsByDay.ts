import type { SummaryArtifact } from './types';

type GroupedArtifactsByDay = Record<string, SummaryArtifact[]>;

const toDayKey = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

export const artifactDayKey = (artifact: SummaryArtifact): string | null =>
  toDayKey(artifact.sourceMetadata?.dateISO) ?? toDayKey(artifact.createdAtISO);

export const groupArtifactsByDay = (artifacts: SummaryArtifact[]): GroupedArtifactsByDay => {
  return artifacts.reduce<GroupedArtifactsByDay>((acc, artifact) => {
    const dayKey = artifactDayKey(artifact);
    if (!dayKey) {
      return acc;
    }

    if (!acc[dayKey]) {
      acc[dayKey] = [];
    }
    acc[dayKey].push(artifact);
    return acc;
  }, {});
};
