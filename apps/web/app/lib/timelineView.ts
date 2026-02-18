import { artifactKey } from './artifactMerge';
import type { TimelineIndex, TimelineIndexSummary } from './indexTypes';
import type { SourceMetadata, SummaryArtifact } from './types';

export type TimelineEntryStatus = 'summarized' | 'pending';
export type TimelineEntryKind = 'summary' | 'selection';
export type TimelineGroupMode = 'day' | 'week' | 'month';

export type TimelineSelectionInput = {
  source: 'gmail' | 'drive';
  id: string;
  title: string;
  dateISO?: string;
  metadata?: {
    from?: string;
    subject?: string;
    mimeType?: string;
    modifiedTime?: string;
  };
};

export type TimelineEntry = {
  key: string;
  source: 'gmail' | 'drive';
  id: string;
  title: string;
  dateISO?: string;
  status: TimelineEntryStatus;
  kind: TimelineEntryKind;
  tags: string[];
  hasDriveLink: boolean;
  driveWebViewLink?: string;
  previewText: string;
  summary?: string;
  highlights?: string[];
  sourcePreview?: string;
  sourceMetadata?: SourceMetadata;
  metadata?: TimelineSelectionInput['metadata'];
};

export type TimelineFilters = {
  source: 'all' | 'gmail' | 'drive';
  status: 'all' | TimelineEntryStatus;
  kind: 'all' | TimelineEntryKind;
  tag: 'all' | string;
  text: string;
  dateFromISO?: string;
  dateToISO?: string;
};

export type TimelineGroup = {
  key: string;
  label: string;
  entries: TimelineEntry[];
};

const PREVIEW_LIMIT = 160;

const toValidDate = (iso?: string) => {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', options).format(date);

const buildPreviewText = (artifact?: SummaryArtifact) => {
  const candidate = artifact?.summary || artifact?.sourcePreview || '';
  if (!candidate) {
    return '';
  }
  return candidate.length > PREVIEW_LIMIT ? `${candidate.slice(0, PREVIEW_LIMIT)}…` : candidate;
};

const collectTags = (artifact?: SummaryArtifact) => {
  const tags = new Set<string>();
  artifact?.sourceMetadata?.labels?.forEach((label) => tags.add(label));
  if (artifact?.sourceMetadata?.mimeType) {
    tags.add(artifact.sourceMetadata.mimeType);
  }
  return Array.from(tags);
};

const buildEntryMetadata = (
  selection: TimelineSelectionInput,
  artifact?: SummaryArtifact,
): TimelineSelectionInput['metadata'] => ({
  from: artifact?.sourceMetadata?.from ?? selection.metadata?.from,
  subject: artifact?.sourceMetadata?.subject ?? selection.metadata?.subject,
  mimeType: artifact?.sourceMetadata?.mimeType ?? selection.metadata?.mimeType,
  modifiedTime: artifact?.sourceMetadata?.driveModifiedTime ?? selection.metadata?.modifiedTime,
});

const buildIndexSummaryMap = (index?: TimelineIndex | null) => {
  const map = new Map<string, TimelineIndexSummary>();
  index?.summaries?.forEach((summary) => {
    map.set(artifactKey(summary.source, summary.sourceId), summary);
  });
  return map;
};

export const buildTimelineEntries = (
  selections: TimelineSelectionInput[],
  artifacts: Record<string, SummaryArtifact>,
  index?: TimelineIndex | null,
): TimelineEntry[] => {
  const indexMap = buildIndexSummaryMap(index);

  return selections.map((selection) => {
    const key = artifactKey(selection.source, selection.id);
    const artifact = artifacts[key];
    const indexSummary = indexMap.get(key);
    const driveWebViewLink =
      artifact?.driveWebViewLink ??
      artifact?.sourceMetadata?.driveWebViewLink ??
      indexSummary?.webViewLink;
    const dateISO =
      artifact?.createdAtISO ||
      selection.dateISO ||
      artifact?.sourceMetadata?.driveModifiedTime ||
      undefined;

    return {
      key,
      source: selection.source,
      id: selection.id,
      title: selection.title || artifact?.title || 'Untitled',
      dateISO,
      status: artifact ? 'summarized' : 'pending',
      kind: artifact ? 'summary' : 'selection',
      tags: collectTags(artifact),
      hasDriveLink: Boolean(driveWebViewLink),
      driveWebViewLink,
      previewText: buildPreviewText(artifact),
      summary: artifact?.summary,
      highlights: artifact?.highlights,
      sourcePreview: artifact?.sourcePreview,
      sourceMetadata: artifact?.sourceMetadata,
      metadata: buildEntryMetadata(selection, artifact),
    };
  });
};

export const sortEntries = (entries: TimelineEntry[]) => {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aTime = toValidDate(a.entry.dateISO)?.getTime() ?? 0;
      const bTime = toValidDate(b.entry.dateISO)?.getTime() ?? 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
};

export const filterEntries = (entries: TimelineEntry[], filters: TimelineFilters) => {
  const query = filters.text.trim().toLowerCase();
  const tag = filters.tag !== 'all' ? filters.tag : null;
  return entries.filter((entry) => {
    if (filters.source !== 'all' && entry.source !== filters.source) {
      return false;
    }
    if (filters.status !== 'all' && entry.status !== filters.status) {
      return false;
    }
    if (filters.kind !== 'all' && entry.kind !== filters.kind) {
      return false;
    }
    if (tag && !entry.tags.includes(tag)) {
      return false;
    }
    if (filters.dateFromISO || filters.dateToISO) {
      const date = toValidDate(entry.dateISO);
      if (date) {
        if (filters.dateFromISO) {
          const from = toValidDate(filters.dateFromISO);
          if (from && date.getTime() < from.getTime()) {
            return false;
          }
        }
        if (filters.dateToISO) {
          const to = toValidDate(filters.dateToISO);
          if (to && date.getTime() > to.getTime()) {
            return false;
          }
        }
      }
    }
    if (query) {
      const haystack = `${entry.title} ${entry.previewText}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
};

const groupLabel = (date: Date, mode: TimelineGroupMode) => {
  if (mode === 'day') {
    return formatDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (mode === 'month') {
    return formatDate(date, { month: 'long', year: 'numeric' });
  }
  return `Week of ${formatDate(date, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

const startOfWeekUtc = (date: Date) => {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff));
};

export const groupEntries = (entries: TimelineEntry[], mode: TimelineGroupMode) => {
  const groups = new Map<string, TimelineGroup>();

  entries.forEach((entry) => {
    const date = toValidDate(entry.dateISO);
    const groupKey = date
      ? mode === 'day'
        ? date.toISOString().slice(0, 10)
        : mode === 'month'
          ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
          : `week-${startOfWeekUtc(date).toISOString().slice(0, 10)}`
      : 'unknown';
    const label = date
      ? mode === 'week'
        ? groupLabel(startOfWeekUtc(date), mode)
        : groupLabel(date, mode)
      : 'Unknown date';

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { key: groupKey, label, entries: [] });
    }
    groups.get(groupKey)?.entries.push(entry);
  });

  return Array.from(groups.values());
};
