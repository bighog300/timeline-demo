import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { TimelineIndexSummary } from './indexTypes';
import { findIndexFile, readIndexFile } from './indexDrive';
import type { LogContext } from './logger';
import { logWarn, time } from './logger';
import { findSnippet, matchSummaryArtifact, normalizeQuery } from './searchIndex';
import type { SummaryArtifact } from './types';
import { isSummaryArtifact, normalizeArtifact } from './validateArtifact';

export type ChatContextItem = {
  artifactId: string;
  title: string;
  dateISO?: string;
  snippet: string;
  kind: 'summary';
  source: 'gmail' | 'drive';
  sourceId: string;
};

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

const SUMMARY_SUFFIX = ' - Summary.json';
const DEFAULT_MAX_ITEMS = 8;
const MAX_ITEMS = 20;
const DEFAULT_MAX_SNIPPET_CHARS = 800;
const DEFAULT_MAX_CONTEXT_CHARS = 12000;
const LIST_PAGE_SIZE = 50;
const MAX_JSON_DOWNLOADS = 20;

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

const buildContextItem = (
  artifact: SummaryArtifact,
  snippet: string,
  maxSnippetChars: number,
): ChatContextItem => ({
  artifactId: artifact.driveFileId || artifact.artifactId,
  title: artifact.title,
  dateISO: artifact.createdAtISO || artifact.sourceMetadata?.dateISO || undefined,
  snippet: truncateText(snippet, maxSnippetChars),
  kind: 'summary',
  source: artifact.source,
  sourceId: artifact.sourceId,
});

export const buildContextString = (
  items: ChatContextItem[],
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
) => {
  let context = '';
  const normalizedItems: ChatContextItem[] = [];

  for (const item of items) {
    const header = `SOURCE ${normalizedItems.length + 1}: ${item.title}${
      item.dateISO ? ` (${item.dateISO})` : ''
    }\n`;
    const baseSnippet = item.snippet || '';
    const remaining = maxContextChars - context.length;
    if (remaining <= header.length + 1) {
      break;
    }

    const snippetBudget = remaining - header.length - 2;
    const snippet = truncateText(baseSnippet, Math.max(snippetBudget, 0));
    const block = `${header}${snippet}\n\n`;
    if (context.length + block.length > maxContextChars) {
      break;
    }

    context += block;
    normalizedItems.push({ ...item, snippet });
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
}: {
  queryText: string;
  summaries: TimelineIndexSummary[];
  artifacts: SummaryArtifact[];
  maxItems?: number;
  maxSnippetChars?: number;
  maxContextChars?: number;
}): ChatContextPack => {
  const normalizedQuery = normalizeQuery(queryText);
  const maxContextItems = clampMaxItems(maxItems);
  const artifactMap = new Map(artifacts.map((artifact) => [artifact.driveFileId, artifact]));
  const matchedSummaries = summaries.filter((summary) => matchIndexSummary(summary, normalizedQuery));
  const items: ChatContextItem[] = [];

  for (const summary of matchedSummaries.slice(0, maxContextItems)) {
    const artifact = artifactMap.get(summary.driveFileId);
    if (!artifact) {
      continue;
    }
    const snippet = pickSnippet(artifact, normalizedQuery);
    items.push(buildContextItem(artifact, snippet, maxSnippetChars));
  }

  const limited = buildContextString(items, maxContextChars);
  return {
    items: limited.items,
    debug: { usedIndex: true, totalConsidered: summaries.length },
  };
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
  const parsed = parseDriveJson(response.data);
  if (!isSummaryArtifact(parsed)) {
    return null;
  }

  const normalized = normalizeArtifact(parsed);
  return {
    ...normalized,
    driveFileId: normalized.driveFileId || fileId,
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

      const items = artifacts.map((artifact) =>
        buildContextItem(artifact, pickSnippet(artifact, normalizedQuery), maxSnippetChars),
      );
      const limited = buildContextString(items, maxContextChars);
      return {
        items: limited.items,
        debug: { usedIndex: true, totalConsidered: index.summaries.length },
      };
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

  const items: ChatContextItem[] = [];
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
    items.push(buildContextItem(artifact, snippet, maxSnippetChars));
  }

  const limited = buildContextString(items.slice(0, maxContextItems), maxContextChars);
  return {
    items: limited.items,
    debug: { usedIndex: false, totalConsidered: candidates.length },
  };
};
