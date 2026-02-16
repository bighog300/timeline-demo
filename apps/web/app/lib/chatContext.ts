import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { TimelineIndexSummary } from './indexTypes';
import { findIndexFile, readIndexFile } from './indexDrive';
import type { LogContext } from './logger';
import { logWarn, time } from './logger';
import { findSnippet, matchSummaryArtifact, normalizeQuery } from './searchIndex';
import { isSelectionSetRunArtifact } from './runArtifacts';
import {
  isDriveSelectionSet,
  isGmailSelectionSet,
  type SelectionSet,
} from './selectionSets';
import type { SummaryArtifact } from './types';
import { isSummaryArtifact, normalizeArtifact } from './validateArtifact';

export type ChatSummaryContextItem = {
  artifactId: string;
  title: string;
  dateISO?: string;
  snippet: string;
  kind: 'summary';
  source: 'gmail' | 'drive';
  sourceId: string;
};

export type ChatSelectionSetContextItem = {
  kind: 'selection_set';
  id: string;
  title: string;
  source: 'gmail' | 'drive';
  q: string;
  updatedAtISO: string;
  text: string;
};

export type ChatRunContextItem = {
  kind: 'run';
  id: string;
  action: 'run' | 'summarize' | 'chat_originals_opened';
  selectionSetId?: string;
  selectionSetTitle?: string;
  startedAtISO: string;
  finishedAtISO?: string;
  status: 'success' | 'partial_success' | 'failed';
  foundCount?: number;
  processedCount?: number;
  failedCount?: number;
  requestIds?: string[];
  text: string;
};

export type ChatContextItem =
  | ChatSummaryContextItem
  | ChatSelectionSetContextItem
  | ChatRunContextItem;

export type ChatContextPack = {
  items: ChatContextItem[];
  debug: { usedIndex: boolean; totalConsidered: number };
};

type DriveListingFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
};

type ChatOriginalsOpenedArtifact = {
  kind: 'chat_originals_opened';
  version: 1;
  id?: string;
  startedAt: string;
  finishedAt: string;
  opened: Array<{ artifactId: string; source: 'gmail' | 'drive'; sourceId: string }>;
  counts: {
    openedCount: number;
    truncatedCount: number;
  };
  status: 'success' | 'partial' | 'failed';
  requestIds: string[];
};

const SUMMARY_SUFFIX = ' - Summary.json';
const DEFAULT_MAX_ITEMS = 8;
const MAX_ITEMS = 20;
const DEFAULT_MAX_SNIPPET_CHARS = 800;
const DEFAULT_MAX_CONTEXT_CHARS = 12000;
const LIST_PAGE_SIZE = 50;
const MAX_JSON_DOWNLOADS = 20;
const MAX_SELECTION_SETS = 5;
const MAX_RECENT_RUNS = 10;
const MAX_META_TEXT_CHARS = 800;
const SYNTHESIS_FALLBACK_MAX_SUMMARIES = 10;

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

const clampMaxItems = (value?: number) => {
  const candidate = Number.isFinite(value) ? (value as number) : DEFAULT_MAX_ITEMS;
  return Math.min(Math.max(candidate, 1), MAX_ITEMS);
};

const truncateText = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return value;
  }
  const clipped = value.slice(0, Math.max(0, maxChars - 14)).trimEnd();
  return `${clipped}… [truncated]`;
};

const parseSafeJson = (data: unknown) => {
  try {
    return parseDriveJson(data);
  } catch {
    return null;
  }
};

const toTimestamp = (value?: string) => {
  if (!value) {
    return 0;
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isChatOriginalsOpenedArtifact = (value: unknown): value is ChatOriginalsOpenedArtifact => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.kind === 'chat_originals_opened' &&
    value.version === 1 &&
    typeof value.startedAt === 'string' &&
    typeof value.finishedAt === 'string' &&
    Array.isArray(value.opened) &&
    value.opened.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.artifactId === 'string' &&
        (entry.source === 'gmail' || entry.source === 'drive') &&
        typeof entry.sourceId === 'string',
    ) &&
    isRecord(value.counts) &&
    typeof value.counts.openedCount === 'number' &&
    typeof value.counts.truncatedCount === 'number' &&
    (value.status === 'success' || value.status === 'partial' || value.status === 'failed') &&
    Array.isArray(value.requestIds) &&
    value.requestIds.every((requestId) => typeof requestId === 'string')
  );
};

const formatContextHeader = (item: ChatContextItem, index: number) => {
  const sourceNumber = index + 1;
  if (item.kind === 'summary') {
    return `SOURCE ${sourceNumber} (SUMMARY): ${item.title}${item.dateISO ? ` (${item.dateISO})` : ''}`;
  }

  if (item.kind === 'selection_set') {
    return `SOURCE ${sourceNumber} (SAVED SEARCH): ${item.title} (${item.updatedAtISO})`;
  }

  const runTitle = item.selectionSetTitle ? `${item.action} • ${item.selectionSetTitle}` : item.action;
  return `SOURCE ${sourceNumber} (RUN): ${runTitle}${item.finishedAtISO ? ` (${item.finishedAtISO})` : ''}`;
};

const getContextBody = (item: ChatContextItem) => (item.kind === 'summary' ? item.snippet : item.text);

const selectionSetText = (selectionSet: SelectionSet) =>
  truncateText(
    `Saved search: ${selectionSet.title} (source: ${selectionSet.source}). Query: ${selectionSet.query.q}. Updated: ${selectionSet.updatedAt}.`,
    MAX_META_TEXT_CHARS,
  );

const runText = (payload: {
  action: 'run' | 'summarize' | 'chat_originals_opened';
  status: 'success' | 'partial_success' | 'failed';
  startedAtISO: string;
  finishedAtISO?: string;
  selectionSetTitle?: string;
  foundCount?: number;
  processedCount?: number;
  failedCount?: number;
  requestIds?: string[];
  chatOpenedCount?: number;
}) => {
  if (payload.action === 'chat_originals_opened') {
    return truncateText(
      `Chat opened originals for ${payload.chatOpenedCount ?? 0} sources (metadata only). Finished: ${payload.finishedAtISO ?? payload.startedAtISO}.`,
      MAX_META_TEXT_CHARS,
    );
  }

  const counts =
    payload.foundCount !== undefined || payload.processedCount !== undefined || payload.failedCount !== undefined
      ? ` Counts: found=${payload.foundCount ?? 0}, processed=${payload.processedCount ?? 0}, failed=${payload.failedCount ?? 0}.`
      : '';
  const requestIds = payload.requestIds && payload.requestIds.length > 0
    ? ` Request IDs: ${payload.requestIds.slice(0, 3).join(', ')}.`
    : '';

  return truncateText(
    `Run action: ${payload.action}. Saved search: ${payload.selectionSetTitle ?? 'unknown'}. Status: ${payload.status}. Started: ${payload.startedAtISO}. Finished: ${payload.finishedAtISO ?? 'in progress'}.${counts}${requestIds}`,
    MAX_META_TEXT_CHARS,
  );
};

export const isSummaryJsonFile = (file: DriveListingFile) => {
  const name = (file.name ?? '').toLowerCase();
  if (!name.endsWith(SUMMARY_SUFFIX.toLowerCase())) {
    return false;
  }
  if (name.endsWith(' - summary.md')) {
    return false;
  }
  return true;
};

const matchIndexSummary = (summary: TimelineIndexSummary, query: string) => {
  if (!query) {
    return false;
  }

  const haystack = [summary.title, summary.sourceId, summary.source].filter(Boolean).join(' ');
  return haystack.toLowerCase().includes(query);
};

const pickSnippet = (artifact: SummaryArtifact, query: string) => {
  if (query) {
    const matched = matchSummaryArtifact(artifact, query);
    if (matched.snippet) {
      return matched.snippet;
    }
  }

  if (artifact.summary) {
    return artifact.summary;
  }

  if (Array.isArray(artifact.highlights) && artifact.highlights.length > 0) {
    return artifact.highlights.join(' ');
  }

  if (artifact.title && query) {
    return findSnippet(artifact.title, query);
  }

  return '';
};

const buildSummaryContextItem = (
  artifact: SummaryArtifact,
  snippet: string,
  maxSnippetChars: number,
): ChatSummaryContextItem => ({
  artifactId: artifact.driveFileId || artifact.artifactId,
  title: artifact.title,
  dateISO: artifact.createdAtISO || artifact.sourceMetadata?.dateISO || undefined,
  snippet: truncateText(snippet, maxSnippetChars),
  kind: 'summary',
  source: artifact.source,
  sourceId: artifact.sourceId,
});

const scoreSelectionSet = (set: ChatSelectionSetContextItem, normalizedQuery: string) => {
  if (!normalizedQuery) {
    return 0;
  }

  const haystack = `${set.title} ${set.q} ${set.source}`.toLowerCase();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return queryTokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
};

const computeMetaBudget = (maxContextItems: number) =>
  Math.min(5, Math.max(2, Math.floor(maxContextItems * 0.25)));

type RankedSummaryContextItem = {
  item: ChatSummaryContextItem;
  artifactKey: string;
  recencyTs: number;
};

const RECENCY_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const normalizeSummaryTitle = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();

const dateBucketKey = (dateISO?: string) => {
  const timestamp = toTimestamp(dateISO);
  if (!timestamp) {
    return 'unknown';
  }

  const date = new Date(timestamp);
  const day = date.toISOString().slice(0, 10);
  return day;
};

const rankSummariesWithRecencyAndDiversity = (
  candidates: RankedSummaryContextItem[],
  desiredCount: number,
  nowTs = Date.now(),
) => {
  if (desiredCount <= 0) {
    return [] as RankedSummaryContextItem[];
  }

  if (candidates.length <= desiredCount) {
    return candidates.slice(0, desiredCount);
  }

  const scored = candidates
    .map((candidate, index) => {
      const ageMs = candidate.recencyTs > 0 ? Math.max(0, nowTs - candidate.recencyTs) : Number.POSITIVE_INFINITY;
      const recencyBoost = ageMs <= RECENCY_WEEK_MS ? 0.35 : ageMs <= RECENCY_MONTH_MS ? 0.15 : 0;
      return {
        candidate,
        index,
        score: candidates.length - index + recencyBoost,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const hasDateDiversity = new Set(candidates.map((candidate) => dateBucketKey(candidate.item.dateISO))).size >= 2;
  const applyDateBucketLimit = hasDateDiversity && candidates.length >= desiredCount + 1;
  const perDayBucketLimit = desiredCount >= 4 ? 2 : 1;
  const applyDedupe = candidates.length >= desiredCount + 1;

  const selected: RankedSummaryContextItem[] = [];
  const selectedKeys = new Set<string>();
  const bucketCounts = new Map<string, number>();
  const normalizedTitles = new Set<string>();
  const sourceIds = new Set<string>();

  for (const entry of scored) {
    if (selected.length >= desiredCount) {
      break;
    }

    const { candidate } = entry;
    const titleKey = normalizeSummaryTitle(candidate.item.title);
    const sourceKey = `${candidate.item.source}:${candidate.item.sourceId}`;
    const bucketKey = dateBucketKey(candidate.item.dateISO);
    const bucketCount = bucketCounts.get(bucketKey) ?? 0;

    if (applyDedupe && (normalizedTitles.has(titleKey) || sourceIds.has(sourceKey))) {
      continue;
    }
    if (applyDateBucketLimit && bucketCount >= perDayBucketLimit) {
      continue;
    }

    selected.push(candidate);
    selectedKeys.add(candidate.artifactKey);
    bucketCounts.set(bucketKey, bucketCount + 1);
    normalizedTitles.add(titleKey);
    sourceIds.add(sourceKey);
  }

  if (selected.length < desiredCount) {
    for (const entry of scored) {
      if (selected.length >= desiredCount) {
        break;
      }
      if (selectedKeys.has(entry.candidate.artifactKey)) {
        continue;
      }

      const titleKey = normalizeSummaryTitle(entry.candidate.item.title);
      const sourceKey = `${entry.candidate.item.source}:${entry.candidate.item.sourceId}`;
      if (applyDedupe && (normalizedTitles.has(titleKey) || sourceIds.has(sourceKey))) {
        continue;
      }

      selected.push(entry.candidate);
      selectedKeys.add(entry.candidate.artifactKey);
      normalizedTitles.add(titleKey);
      sourceIds.add(sourceKey);
    }
  }

  if (selected.length < desiredCount) {
    for (const entry of scored) {
      if (selected.length >= desiredCount) {
        break;
      }
      if (selectedKeys.has(entry.candidate.artifactKey)) {
        continue;
      }
      selected.push(entry.candidate);
      selectedKeys.add(entry.candidate.artifactKey);
    }
  }

  if (applyDedupe && selected.length > 1) {
    const dedupedSelection: RankedSummaryContextItem[] = [];
    const dedupedKeys = new Set<string>();
    const dedupedTitles = new Set<string>();
    const dedupedSources = new Set<string>();

    for (const candidate of selected) {
      const titleKey = normalizeSummaryTitle(candidate.item.title);
      const sourceKey = `${candidate.item.source}:${candidate.item.sourceId}`;
      if (dedupedTitles.has(titleKey) || dedupedSources.has(sourceKey)) {
        continue;
      }
      dedupedSelection.push(candidate);
      dedupedKeys.add(candidate.artifactKey);
      dedupedTitles.add(titleKey);
      dedupedSources.add(sourceKey);
    }

    if (dedupedSelection.length < desiredCount) {
      for (const entry of scored) {
        if (dedupedSelection.length >= desiredCount) {
          break;
        }
        if (dedupedKeys.has(entry.candidate.artifactKey)) {
          continue;
        }
        const titleKey = normalizeSummaryTitle(entry.candidate.item.title);
        const sourceKey = `${entry.candidate.item.source}:${entry.candidate.item.sourceId}`;
        if (dedupedTitles.has(titleKey) || dedupedSources.has(sourceKey)) {
          continue;
        }
        dedupedSelection.push(entry.candidate);
        dedupedKeys.add(entry.candidate.artifactKey);
        dedupedTitles.add(titleKey);
        dedupedSources.add(sourceKey);
      }
    }

    if (dedupedSelection.length >= desiredCount) {
      return dedupedSelection.slice(0, desiredCount);
    }
  }

  return selected;
};

const rankedSummaryRecency = (artifact: SummaryArtifact, fallbackDateISO?: string) =>
  toTimestamp(artifact.sourceMetadata?.driveModifiedTime || fallbackDateISO || artifact.createdAtISO);

const prioritizeSummaryItems = ({
  selectedSummaries,
  allSummaries,
  synthesisMode,
  maxContextItems,
  metaItems,
}: {
  selectedSummaries: RankedSummaryContextItem[];
  allSummaries: RankedSummaryContextItem[];
  synthesisMode?: boolean;
  maxContextItems: number;
  metaItems: ChatContextItem[];
}) => {
  const requiresSynthesisMinimum = synthesisMode && allSummaries.length >= 2;
  let limitedMetaItems = metaItems;
  let summaryBudget = Math.max(0, maxContextItems - limitedMetaItems.length);

  if (requiresSynthesisMinimum && summaryBudget < 2) {
    limitedMetaItems = limitedMetaItems.slice(0, Math.max(0, maxContextItems - 2));
    summaryBudget = Math.max(0, maxContextItems - limitedMetaItems.length);
  }

  let prioritizedSummaries = selectedSummaries;

  if (synthesisMode && prioritizedSummaries.length === 0 && allSummaries.length > 0) {
    const remainingBudgetForSummaries = Math.max(0, maxContextItems - computeMetaBudget(maxContextItems));
    const fallbackCount = Math.min(
      SYNTHESIS_FALLBACK_MAX_SUMMARIES,
      Math.max(1, remainingBudgetForSummaries),
    );
    prioritizedSummaries = allSummaries.slice(0, fallbackCount);
  }

  if (requiresSynthesisMinimum && prioritizedSummaries.length < 2) {
    const remainingBudgetForSummaries = Math.max(0, maxContextItems - computeMetaBudget(maxContextItems));
    const fallbackCount = Math.min(
      SYNTHESIS_FALLBACK_MAX_SUMMARIES,
      Math.max(2, remainingBudgetForSummaries),
    );
    const deduped = new Map<string, RankedSummaryContextItem>();
    for (const candidate of [...allSummaries.slice(0, fallbackCount), ...prioritizedSummaries]) {
      if (!deduped.has(candidate.artifactKey)) {
        deduped.set(candidate.artifactKey, candidate);
      }
    }
    prioritizedSummaries = [...deduped.values()];
  }

  const rankedSummaries = rankSummariesWithRecencyAndDiversity(prioritizedSummaries, summaryBudget);

  return {
    summaries: rankedSummaries.map((entry) => entry.item),
    metaItems: limitedMetaItems,
  };
};

const buildMetaItems = ({
  selectionSets,
  runs,
  query,
  maxContextItems,
}: {
  selectionSets: ChatSelectionSetContextItem[];
  runs: ChatRunContextItem[];
  query: string;
  maxContextItems: number;
}) => {
  if (maxContextItems <= 0) {
    return [] as ChatContextItem[];
  }

  const metaBudget = computeMetaBudget(maxContextItems);
  const sortedSets = [...selectionSets].sort((left, right) => {
    const scoreDiff = scoreSelectionSet(right, query) - scoreSelectionSet(left, query);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return toTimestamp(right.updatedAtISO) - toTimestamp(left.updatedAtISO);
  });

  const selectedSets = sortedSets.slice(0, Math.min(2, metaBudget));
  const runBudget = Math.max(0, metaBudget - selectedSets.length);
  const selectedRuns = [...runs]
    .sort((left, right) => toTimestamp(right.finishedAtISO ?? right.startedAtISO) - toTimestamp(left.finishedAtISO ?? left.startedAtISO))
    .slice(0, runBudget);

  return [...selectedSets, ...selectedRuns].slice(0, metaBudget);
};

const readSummaryArtifact = async (
  drive: drive_v3.Drive,
  fileId: string,
  ctx?: LogContext,
): Promise<SummaryArtifact | null> => {
  const readOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.get(
              { fileId, alt: 'media' },
              {
                responseType: 'json',
                signal: timeoutSignal,
              },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );

  const response = ctx ? await time(ctx, 'drive.files.get.summary', readOperation) : await readOperation();
  const parsed = parseSafeJson(response.data);
  if (!isSummaryArtifact(parsed)) {
    return null;
  }

  const normalized = normalizeArtifact(parsed);
  return {
    ...normalized,
    driveFileId: normalized.driveFileId || fileId,
  };
};

const readSelectionSetMetadata = async (
  drive: drive_v3.Drive,
  fileId: string,
): Promise<ChatSelectionSetContextItem | null> => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get(
          { fileId, alt: 'media' },
          {
            responseType: 'arraybuffer',
            signal: timeoutSignal,
          },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const parsed = parseSafeJson(response.data);
  if (!isGmailSelectionSet(parsed) && !isDriveSelectionSet(parsed)) {
    return null;
  }

  return {
    kind: 'selection_set',
    id: parsed.id,
    title: parsed.title,
    source: parsed.source,
    q: parsed.query.q,
    updatedAtISO: parsed.updatedAt,
    text: selectionSetText(parsed),
  };
};

const listRecentSelectionSetItems = async (
  drive: drive_v3.Drive,
  driveFolderId: string,
  ctx?: LogContext,
): Promise<ChatSelectionSetContextItem[]> => {
  const listOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: `'${driveFolderId}' in parents and trashed=false and name contains 'SelectionSet-'`,
                orderBy: 'modifiedTime desc',
                pageSize: MAX_SELECTION_SETS,
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

  const listResponse = ctx
    ? await time(ctx, 'drive.files.list.chat_selection_sets', listOperation)
    : await listOperation();

  const files = listResponse.data.files ?? [];
  const items = await Promise.all(
    files
      .filter((file): file is { id: string } => typeof file.id === 'string')
      .map((file) => readSelectionSetMetadata(drive, file.id)),
  );

  return items
    .filter((item): item is ChatSelectionSetContextItem => Boolean(item))
    .sort((left, right) => toTimestamp(right.updatedAtISO) - toTimestamp(left.updatedAtISO))
    .slice(0, MAX_SELECTION_SETS);
};

const readRunMetadata = async (
  drive: drive_v3.Drive,
  file: { id: string; name?: string | null },
): Promise<ChatRunContextItem | null> => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get(
          { fileId: file.id, alt: 'media' },
          {
            responseType: 'arraybuffer',
            signal: timeoutSignal,
          },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const parsed = parseSafeJson(response.data);
  if (isSelectionSetRunArtifact(parsed)) {
    return {
      kind: 'run' as const,
      id: parsed.id,
      action: parsed.action,
      selectionSetId: parsed.selectionSet.id,
      selectionSetTitle: parsed.selectionSet.title,
      startedAtISO: parsed.startedAt,
      finishedAtISO: parsed.finishedAt ?? undefined,
      status: parsed.result.status,
      foundCount: parsed.result.foundCount,
      processedCount: parsed.result.processedCount,
      failedCount: parsed.result.failedCount,
      requestIds: parsed.result.requestIds.slice(0, 3),
      text: runText({
        action: parsed.action,
        status: parsed.result.status,
        startedAtISO: parsed.startedAt,
        finishedAtISO: parsed.finishedAt ?? undefined,
        selectionSetTitle: parsed.selectionSet.title,
        foundCount: parsed.result.foundCount,
        processedCount: parsed.result.processedCount,
        failedCount: parsed.result.failedCount,
        requestIds: parsed.result.requestIds,
      }),
    } satisfies ChatRunContextItem;
  }

  if (!isChatOriginalsOpenedArtifact(parsed)) {
    return null;
  }

  const runId = parsed.id ?? (file.name?.replace(/^ChatRun-/, '').replace(/\.json$/, '') || file.id);
  return {
    kind: 'run' as const,
    id: runId,
    action: 'chat_originals_opened',
    startedAtISO: parsed.startedAt,
    finishedAtISO: parsed.finishedAt,
    status: parsed.status === 'partial' ? 'partial_success' : parsed.status,
    processedCount: parsed.counts.openedCount,
    failedCount: parsed.status === 'failed' ? parsed.counts.openedCount : 0,
    requestIds: parsed.requestIds.slice(0, 3),
    text: runText({
      action: 'chat_originals_opened',
      status: parsed.status === 'partial' ? 'partial_success' : parsed.status,
      startedAtISO: parsed.startedAt,
      finishedAtISO: parsed.finishedAt,
      requestIds: parsed.requestIds,
      chatOpenedCount: parsed.counts.openedCount,
    }),
  } satisfies ChatRunContextItem;
};

const listRecentRunItems = async (
  drive: drive_v3.Drive,
  driveFolderId: string,
  ctx?: LogContext,
): Promise<ChatRunContextItem[]> => {
  const listOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: `'${driveFolderId}' in parents and trashed=false and (name contains 'Run-' or name contains 'ChatRun-')`,
                orderBy: 'modifiedTime desc',
                pageSize: MAX_RECENT_RUNS,
                fields: 'files(id, name, modifiedTime)',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );

  const listResponse = ctx ? await time(ctx, 'drive.files.list.chat_runs', listOperation) : await listOperation();
  const files = listResponse.data.files ?? [];
  const runs = await Promise.all(
    files
      .filter((file): file is { id: string; name?: string | null } => typeof file.id === 'string')
      .map((file) => readRunMetadata(drive, file)),
  );

  const runItems = runs.filter((item): item is ChatRunContextItem => item !== null);

  return runItems
    .sort(
      (left, right) =>
        toTimestamp(right.finishedAtISO ?? right.startedAtISO) -
        toTimestamp(left.finishedAtISO ?? left.startedAtISO),
    )
    .slice(0, MAX_RECENT_RUNS);
};

export const buildContextString = (
  items: ChatContextItem[],
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
) => {
  let context = '';
  const normalizedItems: ChatContextItem[] = [];

  for (const item of items) {
    const header = `${formatContextHeader(item, normalizedItems.length)}\n`;
    const baseBody = getContextBody(item);
    const remaining = maxContextChars - context.length;
    if (remaining <= header.length + 1) {
      break;
    }

    const bodyBudget = remaining - header.length - 2;
    const body = truncateText(baseBody, Math.max(bodyBudget, 0));
    const block = `${header}${body}\n\n`;
    if (context.length + block.length > maxContextChars) {
      break;
    }

    context += block;
    normalizedItems.push(
      item.kind === 'summary'
        ? {
            ...item,
            snippet: body,
          }
        : {
            ...item,
            text: body,
          },
    );
  }

  return { context: context.trim(), items: normalizedItems };
};

export const buildContextPackFromIndexData = ({
  queryText,
  summaries,
  artifacts,
  maxItems,
  maxSnippetChars = DEFAULT_MAX_SNIPPET_CHARS,
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
  selectionSets = [],
  runs = [],
  synthesisMode = false,
}: {
  queryText: string;
  summaries: TimelineIndexSummary[];
  artifacts: SummaryArtifact[];
  maxItems?: number;
  maxSnippetChars?: number;
  maxContextChars?: number;
  selectionSets?: ChatSelectionSetContextItem[];
  runs?: ChatRunContextItem[];
  synthesisMode?: boolean;
}): ChatContextPack => {
  const normalizedQuery = normalizeQuery(queryText);
  const maxContextItems = clampMaxItems(maxItems);
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.driveFileId, artifact]));
  const matchedSummaries = summaries.filter((summary) => matchIndexSummary(summary, normalizedQuery));
  const selectedSummaries: RankedSummaryContextItem[] = [];

  for (const summary of matchedSummaries.slice(0, maxContextItems)) {
    const artifact = artifactMap.get(summary.driveFileId);
    if (!artifact) {
      continue;
    }

    const snippet = pickSnippet(artifact, normalizedQuery);
    selectedSummaries.push({
      item: buildSummaryContextItem(artifact, snippet, maxSnippetChars),
      artifactKey: artifact.driveFileId || artifact.artifactId,
      recencyTs: rankedSummaryRecency(artifact, summary.updatedAtISO || summary.createdAtISO),
    });
  }

  const allSummaries = summaries
    .map((summary) => {
      const artifact = artifactMap.get(summary.driveFileId);
      if (!artifact) {
        return null;
      }

      const snippet = pickSnippet(artifact, normalizedQuery);
      return {
        item: buildSummaryContextItem(artifact, snippet, maxSnippetChars),
        artifactKey: artifact.driveFileId || artifact.artifactId,
        recencyTs: rankedSummaryRecency(artifact, summary.updatedAtISO || summary.createdAtISO),
      } satisfies RankedSummaryContextItem;
    })
    .filter((entry): entry is RankedSummaryContextItem => entry !== null)
    .sort((left, right) => right.recencyTs - left.recencyTs);

  const metaItems = buildMetaItems({
    selectionSets,
    runs,
    query: normalizedQuery,
    maxContextItems,
  });

  const prioritized = prioritizeSummaryItems({
    selectedSummaries,
    allSummaries,
    synthesisMode,
    maxContextItems,
    metaItems,
  });

  const limited = buildContextString([...prioritized.summaries, ...prioritized.metaItems], maxContextChars);
  return {
    items: limited.items,
    debug: { usedIndex: true, totalConsidered: summaries.length },
  };
};

export const buildContextPack = async ({
  queryText,
  drive,
  driveFolderId,
  maxItems,
  ctx,
  maxSnippetChars = DEFAULT_MAX_SNIPPET_CHARS,
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
  synthesisMode = false,
}: {
  queryText: string;
  drive: drive_v3.Drive;
  driveFolderId: string;
  maxItems?: number;
  ctx?: LogContext;
  maxSnippetChars?: number;
  maxContextChars?: number;
  synthesisMode?: boolean;
}): Promise<ChatContextPack> => {
  const normalizedQuery = normalizeQuery(queryText);
  const maxContextItems = clampMaxItems(maxItems);

  if (!normalizedQuery) {
    return { items: [], debug: { usedIndex: false, totalConsidered: 0 } };
  }

  const [selectionSetItems, runItems] = await Promise.all([
    listRecentSelectionSetItems(drive, driveFolderId, ctx),
    listRecentRunItems(drive, driveFolderId, ctx),
  ]);

  const indexFile = await findIndexFile(drive, driveFolderId, ctx);
  if (indexFile?.id) {
    const index = await readIndexFile(drive, indexFile.id, driveFolderId, ctx);
    if (index) {
      const sortedSummaries = [...index.summaries].sort(
        (left, right) =>
          toTimestamp(right.updatedAtISO || right.createdAtISO) -
          toTimestamp(left.updatedAtISO || left.createdAtISO),
      );

      const summariesToRead = synthesisMode
        ? sortedSummaries.slice(0, MAX_JSON_DOWNLOADS)
        : sortedSummaries
            .filter((summary) => matchIndexSummary(summary, normalizedQuery))
            .slice(0, maxContextItems);

      const artifacts: SummaryArtifact[] = [];
      for (const summary of summariesToRead) {
        if (!summary.driveFileId) {
          continue;
        }
        const artifact = await readSummaryArtifact(drive, summary.driveFileId, ctx);
        if (artifact) {
          artifacts.push(artifact);
        } else if (ctx) {
          logWarn(ctx, 'chat_context_summary_invalid', { fileId: summary.driveFileId });
        }
      }

      return buildContextPackFromIndexData({
        queryText,
        summaries: sortedSummaries,
        artifacts,
        maxItems: maxContextItems,
        maxSnippetChars,
        maxContextChars,
        selectionSets: selectionSetItems,
        runs: runItems,
        synthesisMode,
      });
    }
  }

  const listOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: `'${driveFolderId}' in parents and trashed=false and name contains '${SUMMARY_SUFFIX}'`,
                orderBy: 'modifiedTime desc',
                pageSize: LIST_PAGE_SIZE,
                fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );

  const listResponse = ctx
    ? await time(ctx, 'drive.files.list.chat_context', listOperation)
    : await listOperation();
  const candidates = (listResponse.data.files ?? []).filter(isSummaryJsonFile);

  const selectedSummaries: RankedSummaryContextItem[] = [];
  const allSummaries: RankedSummaryContextItem[] = [];

  for (const file of candidates.slice(0, MAX_JSON_DOWNLOADS)) {
    if (!file.id) {
      continue;
    }
    const artifact = await readSummaryArtifact(drive, file.id, ctx);
    if (!artifact) {
      if (ctx) {
        logWarn(ctx, 'chat_context_summary_invalid', { fileId: file.id });
      }
      continue;
    }

    const baseSnippet = pickSnippet(artifact, normalizedQuery);
    const rankedSummary = {
      item: buildSummaryContextItem(artifact, baseSnippet, maxSnippetChars),
      artifactKey: artifact.driveFileId || artifact.artifactId,
      recencyTs: rankedSummaryRecency(artifact, file.modifiedTime || undefined),
    } satisfies RankedSummaryContextItem;

    allSummaries.push(rankedSummary);

    const match = matchSummaryArtifact(artifact, normalizedQuery);
    if (match.matched) {
      selectedSummaries.push({
        ...rankedSummary,
        item: {
          ...rankedSummary.item,
          snippet: truncateText(match.snippet || baseSnippet, maxSnippetChars),
        },
      });
    }
  }

  allSummaries.sort((left, right) => right.recencyTs - left.recencyTs);

  const metaItems = buildMetaItems({
    selectionSets: selectionSetItems,
    runs: runItems,
    query: normalizedQuery,
    maxContextItems,
  });

  const prioritized = prioritizeSummaryItems({
    selectedSummaries,
    allSummaries,
    synthesisMode,
    maxContextItems,
    metaItems,
  });

  const limited = buildContextString([...prioritized.summaries, ...prioritized.metaItems], maxContextChars);
  return {
    items: limited.items,
    debug: { usedIndex: false, totalConsidered: candidates.length },
  };
};
