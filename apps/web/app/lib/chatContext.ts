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

  const metaBudget = Math.min(5, Math.max(2, Math.floor(maxContextItems * 0.25)));
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
}: {
  queryText: string;
  summaries: TimelineIndexSummary[];
  artifacts: SummaryArtifact[];
  maxItems?: number;
  maxSnippetChars?: number;
  maxContextChars?: number;
  selectionSets?: ChatSelectionSetContextItem[];
  runs?: ChatRunContextItem[];
}): ChatContextPack => {
  const normalizedQuery = normalizeQuery(queryText);
  const maxContextItems = clampMaxItems(maxItems);
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.driveFileId, artifact]));
  const matchedSummaries = summaries.filter((summary) => matchIndexSummary(summary, normalizedQuery));
  const summaryItems: ChatSummaryContextItem[] = [];

  for (const summary of matchedSummaries.slice(0, maxContextItems)) {
    const artifact = artifactMap.get(summary.driveFileId);
    if (!artifact) {
      continue;
    }
    const snippet = pickSnippet(artifact, normalizedQuery);
    summaryItems.push(buildSummaryContextItem(artifact, snippet, maxSnippetChars));
  }

  const metaItems = buildMetaItems({
    selectionSets,
    runs,
    query: normalizedQuery,
    maxContextItems,
  });

  const prioritizedSummaries = summaryItems.slice(0, Math.max(0, maxContextItems - metaItems.length));
  const limited = buildContextString([...prioritizedSummaries, ...metaItems], maxContextChars);
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
}: {
  queryText: string;
  drive: drive_v3.Drive;
  driveFolderId: string;
  maxItems?: number;
  ctx?: LogContext;
  maxSnippetChars?: number;
  maxContextChars?: number;
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
      const matchedSummaries = index.summaries.filter((summary) =>
        matchIndexSummary(summary, normalizedQuery),
      );
      const artifacts: SummaryArtifact[] = [];
      for (const summary of matchedSummaries.slice(0, maxContextItems)) {
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
        summaries: matchedSummaries,
        artifacts,
        maxItems: maxContextItems,
        maxSnippetChars,
        maxContextChars,
        selectionSets: selectionSetItems,
        runs: runItems,
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

  const summaryItems: ChatSummaryContextItem[] = [];
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

    const match = matchSummaryArtifact(artifact, normalizedQuery);
    if (!match.matched) {
      continue;
    }

    const snippet = match.snippet || pickSnippet(artifact, normalizedQuery);
    summaryItems.push(buildSummaryContextItem(artifact, snippet, maxSnippetChars));
  }

  const metaItems = buildMetaItems({
    selectionSets: selectionSetItems,
    runs: runItems,
    query: normalizedQuery,
    maxContextItems,
  });

  const summaryBudget = Math.max(0, maxContextItems - metaItems.length);
  const limited = buildContextString([...summaryItems.slice(0, summaryBudget), ...metaItems], maxContextChars);
  return {
    items: limited.items,
    debug: { usedIndex: false, totalConsidered: candidates.length },
  };
};
