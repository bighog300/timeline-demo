import { DriveSelectionSetJsonSchema, DriveSummaryJsonSchema } from '@timeline/shared';
import type { drive_v3 } from 'googleapis';

import { findIndexFile, readIndexFile } from './indexDrive';

export type ChatContextMode = 'recent' | 'selection_set';
export type ChatSourceFilter = 'all' | 'gmail' | 'drive';
export type ChatRecentCount = 8 | 20 | 50;

export type ChatContextSelection = {
  mode: ChatContextMode;
  recentCount: ChatRecentCount;
  sourceFilter: ChatSourceFilter;
  selectionSetId?: string;
};

export type ChatContextItem = {
  artifactId: string;
  title: string;
  source: 'gmail' | 'drive';
  sourceId: string;
  snippet: string;
  dateISO?: string;
  driveWebViewLink?: string;
};

export type LoadedChatContext = {
  items: ChatContextItem[];
  key: string;
  indexMissing: boolean;
  selectionSetName?: string;
  stats?: {
    selectionTotal: number;
    summarizedCount: number;
    missingCount: number;
  };
  missing?: Array<{ source: 'gmail' | 'drive'; id: string; title?: string; dateISO?: string }>;
  debug: { usedIndex: boolean; totalConsidered: number };
};

export type ChatContextLoadResult = LoadedChatContext;

const SUMMARY_SUFFIX = ' - Summary.json';
const FALLBACK_LIST_CAP = 200;
const DEFAULT_SELECTION: ChatContextSelection = {
  mode: 'recent',
  recentCount: 8,
  sourceFilter: 'all',
};

const toSourceLabel = (sourceFilter: ChatSourceFilter) => {
  if (sourceFilter === 'gmail') return 'Gmail';
  if (sourceFilter === 'drive') return 'Drive';
  return 'All';
};

export const buildContextKey = (selection: ChatContextSelection, selectionSetName?: string) =>
  selection.mode === 'selection_set'
    ? `Selection Set: ${selectionSetName ?? 'Unknown'} (${toSourceLabel(selection.sourceFilter)})`
    : `Recent ${selection.recentCount} (${toSourceLabel(selection.sourceFilter)})`;

const parseSummaryItem = (value: unknown): ChatContextItem | null => {
  const parsed = DriveSummaryJsonSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return {
    artifactId: parsed.data.driveFileId || parsed.data.artifactId,
    title: parsed.data.title,
    source: parsed.data.source,
    sourceId: parsed.data.sourceId,
    snippet: parsed.data.summary,
    dateISO: parsed.data.sourceMetadata?.dateISO ?? parsed.data.createdAtISO,
    driveWebViewLink: parsed.data.driveWebViewLink,
  };
};

const readSummary = async (drive: drive_v3.Drive, fileId: string) => {
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json' });
  return parseSummaryItem(response.data);
};

const normalizeTs = (value?: string) => {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const parseSelectionSet = async (drive: drive_v3.Drive, fileId: string) => {
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json' });
  const parsed = DriveSelectionSetJsonSchema.safeParse(response.data);
  return parsed.success ? parsed.data : null;
};

const buildSelectionCoverage = ({
  selectionItems,
  sourceFilter,
  index,
  fallbackSummaries,
}: {
  selectionItems: Array<{ source: 'gmail' | 'drive'; id: string; title?: string; dateISO?: string }>;
  sourceFilter: ChatSourceFilter;
  index: Awaited<ReturnType<typeof readIndexFile>>;
  fallbackSummaries: ChatContextItem[] | null;
}) => {
  const indexMap = new Map<string, string>();
  if (index) {
    for (const summary of index.summaries) {
      indexMap.set(`${summary.source}:${summary.sourceId}`, summary.driveFileId);
    }
  }

  const matchedIds = new Set<string>();
  const missing: Array<{ source: 'gmail' | 'drive'; id: string; title?: string; dateISO?: string }> = [];
  let selectionTotal = 0;

  for (const item of selectionItems) {
    if (!sourceAllowed(item.source, sourceFilter)) continue;
    selectionTotal += 1;

    const key = `${item.source}:${item.id}`;
    const matchedId = indexMap.get(key);
    if (matchedId) {
      matchedIds.add(matchedId);
      continue;
    }

    if (fallbackSummaries) {
      const found = fallbackSummaries.find(
        (summary) => summary.source === item.source && summary.sourceId === item.id,
      );
      if (found) {
        matchedIds.add(found.artifactId);
        continue;
      }
    }

    missing.push(item);
  }

  return {
    matchedIds,
    missing,
    selectionTotal,
    summarizedCount: matchedIds.size,
  };
};

export const parseChatContextSelection = (params: {
  mode?: string;
  n?: string;
  source?: string;
  id?: string;
}): ChatContextSelection => {
  const mode: ChatContextMode = params.mode === 'selection_set' ? 'selection_set' : 'recent';
  const n = Number(params.n);
  const recentCount: ChatRecentCount = n === 20 || n === 50 ? n : 8;
  const sourceFilter: ChatSourceFilter =
    params.source === 'gmail' || params.source === 'drive' ? params.source : 'all';
  const selectionSetId = typeof params.id === 'string' && params.id.trim() ? params.id.trim() : undefined;

  return {
    mode,
    recentCount,
    sourceFilter,
    ...(selectionSetId ? { selectionSetId } : {}),
  };
};

const sourceAllowed = (source: 'gmail' | 'drive', filter: ChatSourceFilter) =>
  filter === 'all' || source === filter;

const listRecentSummaryIds = async (drive: drive_v3.Drive, folderId: string, cap: number) => {
  const listResponse = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name contains '${SUMMARY_SUFFIX}'`,
    orderBy: 'modifiedTime desc',
    pageSize: Math.min(cap, FALLBACK_LIST_CAP),
    fields: 'files(id)',
  });
  return (listResponse.data.files ?? []).flatMap((file) => (file.id ? [file.id] : []));
};

export const loadChatContext = async ({
  drive,
  driveFolderId,
  selection = DEFAULT_SELECTION,
}: {
  drive: drive_v3.Drive;
  driveFolderId: string;
  selection?: ChatContextSelection;
}): Promise<LoadedChatContext> => {
  const contextSelection = { ...DEFAULT_SELECTION, ...selection };
  const indexFile = await findIndexFile(drive, driveFolderId);
  const index = indexFile?.id ? await readIndexFile(drive, indexFile.id, driveFolderId) : null;
  const indexMissing = !index;

  if (contextSelection.mode === 'selection_set') {
    if (!contextSelection.selectionSetId) {
      return { items: [], key: buildContextKey(contextSelection), indexMissing, debug: { usedIndex: Boolean(index), totalConsidered: 0 } };
    }

    const set = await parseSelectionSet(drive, contextSelection.selectionSetId);
    if (!set || set.driveFolderId !== driveFolderId) {
      return {
        items: [],
        key: `${buildContextKey(contextSelection)} — Selection set unavailable. Choose a saved search from this app folder.`,
        indexMissing,
        debug: { usedIndex: Boolean(index), totalConsidered: 0 },
      };
    }

    let fallbackSummaries: ChatContextItem[] | null = null;
    if (!index) {
      const ids = await listRecentSummaryIds(drive, driveFolderId, FALLBACK_LIST_CAP);
      fallbackSummaries = (
        await Promise.all(ids.map((id) => readSummary(drive, id)))
      ).filter((item): item is ChatContextItem => item !== null);
    }

    const coverage = buildSelectionCoverage({
      selectionItems: set.items,
      sourceFilter: contextSelection.sourceFilter,
      index,
      fallbackSummaries,
    });

    const items = (
      await Promise.all(Array.from(coverage.matchedIds).map((fileId) => readSummary(drive, fileId)))
    ).filter((item): item is ChatContextItem => item !== null);

    return {
      items,
      key: buildContextKey(contextSelection, set.name),
      indexMissing,
      selectionSetName: set.name,
      stats: {
        selectionTotal: coverage.selectionTotal,
        summarizedCount: coverage.summarizedCount,
        missingCount: coverage.missing.length,
      },
      missing: coverage.missing,
      debug: { usedIndex: Boolean(index), totalConsidered: items.length },
    };
  }

  if (index) {
    const ids = [...index.summaries]
      .filter((summary) => sourceAllowed(summary.source, contextSelection.sourceFilter))
      .sort(
        (a, b) =>
          normalizeTs(b.updatedAtISO ?? b.createdAtISO) - normalizeTs(a.updatedAtISO ?? a.createdAtISO),
      )
      .slice(0, contextSelection.recentCount)
      .map((summary) => summary.driveFileId);

    const items = (
      await Promise.all(ids.map((id) => readSummary(drive, id)))
    ).filter((item): item is ChatContextItem => item !== null);

    return { items, key: buildContextKey(contextSelection), indexMissing, debug: { usedIndex: true, totalConsidered: items.length } };
  }

  const ids = await listRecentSummaryIds(drive, driveFolderId, FALLBACK_LIST_CAP);
  const items = (
    await Promise.all(ids.map((id) => readSummary(drive, id)))
  )
    .filter((item): item is ChatContextItem => item !== null)
    .filter((item) => sourceAllowed(item.source, contextSelection.sourceFilter))
    .slice(0, contextSelection.recentCount);

  return { items, key: buildContextKey(contextSelection), indexMissing, debug: { usedIndex: false, totalConsidered: items.length } };
};

export const buildChatContextString = (items: ChatContextItem[]) => {
  const context = items
    .map((item, index) => `SOURCE ${index + 1}: ${item.title}\n${item.snippet}`)
    .join('\n\n');
  return { context, items };
};
