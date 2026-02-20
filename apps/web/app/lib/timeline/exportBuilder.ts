import type { SummaryArtifact } from '../types';

export type TimelineArtifact = {
  entryKey: string;
  artifact: SummaryArtifact;
};

export type TimelineExportModel = {
  title: string;
  generatedAt: string;
  artifactCount: number;
  groups: Array<{
    label: string;
    items: Array<{
      title: string;
      bullets: string[];
      sourceLabel?: string;
    }>;
  }>;
};

type TimelineGroup = {
  key: string;
  label: string;
  artifacts: TimelineArtifact[];
};

const toValidDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateLabel = (isoDate: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00.000Z`));

const firstSentence = (text?: string) => {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentence = normalized.split(/(?<=[.!?])\s/)[0] ?? normalized;
  return sentence.trim();
};

export const toBullets = (artifact: SummaryArtifact) => {
  if (artifact.highlights?.length) {
    return artifact.highlights.slice(0, 3);
  }
  const parts = artifact.summary
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  return parts.length ? parts : [artifact.summary.slice(0, 180)];
};

export const sourceTypeLabel = (artifact: SummaryArtifact) => {
  if (artifact.sourceMetadata?.subject?.trim()) return artifact.sourceMetadata.subject.trim();
  if (artifact.title?.trim()) return artifact.title.trim();
  if (artifact.driveFileId?.trim()) return artifact.driveFileId.trim();
  return artifact.source === 'drive' ? 'Drive' : artifact.source === 'gmail' ? 'Gmail' : artifact.source;
};

export const timelineCardTitle = (artifact: SummaryArtifact) =>
  firstSentence(artifact.summary) || artifact.title || 'Untitled summary';

export const groupTimelineArtifacts = (artifacts: TimelineArtifact[]): TimelineGroup[] => {
  const dated = new Map<string, TimelineArtifact[]>();
  const undated: TimelineArtifact[] = [];

  artifacts.forEach((item) => {
    const date = toValidDate(item.artifact.contentDateISO);
    if (!date) {
      undated.push(item);
      return;
    }
    const key = date.toISOString().slice(0, 10);
    const items = dated.get(key) ?? [];
    items.push(item);
    dated.set(key, items);
  });

  const groups = Array.from(dated.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => ({
      key,
      label: formatDateLabel(key),
      artifacts: [...entries].sort((a, b) => {
        const aDate = a.artifact.contentDateISO ?? '';
        const bDate = b.artifact.contentDateISO ?? '';
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        return a.artifact.artifactId.localeCompare(b.artifact.artifactId);
      }),
    }));

  if (undated.length) {
    groups.push({
      key: 'undated',
      label: 'Undated',
      artifacts: undated.sort((a, b) => a.artifact.artifactId.localeCompare(b.artifact.artifactId)),
    });
  }

  return groups;
};

export const buildTimelineExportModel = (artifacts: TimelineArtifact[]): TimelineExportModel => ({
  title: 'Timeline Report',
  generatedAt: new Date().toISOString(),
  artifactCount: artifacts.length,
  groups: groupTimelineArtifacts(artifacts).map((group) => ({
    label: group.label,
    items: group.artifacts.map(({ artifact }) => ({
      title: timelineCardTitle(artifact),
      bullets: toBullets(artifact),
      sourceLabel: sourceTypeLabel(artifact),
    })),
  })),
});
