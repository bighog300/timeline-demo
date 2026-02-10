import { randomUUID } from 'crypto';

import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { SelectionSet } from './selectionSets';

export type RunArtifactStatus = 'success' | 'partial_success' | 'failed';

export type SelectionSetRunArtifact = {
  kind: 'selection_set_run';
  version: 1;
  id: string;
  selectionSet: {
    id: string;
    title: string;
    source: 'gmail' | 'drive';
    kind: SelectionSet['kind'];
    query: { q: string };
  };
  action: 'run' | 'summarize';
  startedAt: string;
  finishedAt: string | null;
  caps: {
    maxPages: number;
    maxItems: number;
    pageSize: number;
    batchSize: number;
  };
  result: {
    status: RunArtifactStatus;
    foundCount: number;
    processedCount: number;
    failedCount: number;
    requestIds: string[];
    note: string | null;
  };
  items: {
    ids: string[] | null;
    idsIncluded: boolean;
  };
};

type ListRunArtifactOptions = {
  limit?: number;
};

const parseJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    return JSON.parse(data);
  }

  if (Buffer.isBuffer(data)) {
    return JSON.parse(data.toString('utf8'));
  }

  if (data instanceof Uint8Array) {
    return JSON.parse(Buffer.from(data).toString('utf8'));
  }

  return data;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const toRunArtifactFileName = (id: string) => `Run-${id}.json`;

export const buildRunArtifact = (payload: {
  id?: string;
  selectionSet: SelectionSet;
  action: 'run' | 'summarize';
  startedAt: string;
  caps: SelectionSetRunArtifact['caps'];
}): SelectionSetRunArtifact => ({
  kind: 'selection_set_run',
  version: 1,
  id: payload.id ?? randomUUID(),
  selectionSet: {
    id: payload.selectionSet.id,
    title: payload.selectionSet.title,
    source: payload.selectionSet.source,
    kind: payload.selectionSet.kind,
    query: { q: payload.selectionSet.query.q },
  },
  action: payload.action,
  startedAt: payload.startedAt,
  finishedAt: null,
  caps: payload.caps,
  result: {
    status: 'failed',
    foundCount: 0,
    processedCount: 0,
    failedCount: 0,
    requestIds: [],
    note: null,
  },
  items: {
    ids: null,
    idsIncluded: false,
  },
});

export const isSelectionSetRunArtifact = (value: unknown): value is SelectionSetRunArtifact => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.kind !== 'selection_set_run' ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    !isRecord(value.selectionSet) ||
    (value.action !== 'run' && value.action !== 'summarize') ||
    typeof value.startedAt !== 'string' ||
    (value.finishedAt !== null && typeof value.finishedAt !== 'string') ||
    !isRecord(value.caps) ||
    !isRecord(value.result) ||
    !isRecord(value.items)
  ) {
    return false;
  }

  const selectionSet = value.selectionSet;
  const caps = value.caps;
  const result = value.result;
  const items = value.items;

  return (
    typeof selectionSet.id === 'string' &&
    typeof selectionSet.title === 'string' &&
    (selectionSet.source === 'gmail' || selectionSet.source === 'drive') &&
    (selectionSet.kind === 'gmail_selection_set' || selectionSet.kind === 'drive_selection_set') &&
    isRecord(selectionSet.query) &&
    typeof selectionSet.query.q === 'string' &&
    typeof caps.maxPages === 'number' &&
    typeof caps.maxItems === 'number' &&
    typeof caps.pageSize === 'number' &&
    typeof caps.batchSize === 'number' &&
    (result.status === 'success' || result.status === 'partial_success' || result.status === 'failed') &&
    typeof result.foundCount === 'number' &&
    typeof result.processedCount === 'number' &&
    typeof result.failedCount === 'number' &&
    Array.isArray(result.requestIds) &&
    result.requestIds.every((requestId) => typeof requestId === 'string') &&
    (result.note === null || typeof result.note === 'string') &&
    (items.ids === null || (Array.isArray(items.ids) && items.ids.every((id) => typeof id === 'string') && items.ids.length <= 50)) &&
    typeof items.idsIncluded === 'boolean'
  );
};

export const writeRunArtifactStart = async (
  drive: drive_v3.Drive,
  folderId: string,
  runArtifact: SelectionSetRunArtifact,
) => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: {
              name: toRunArtifactFileName(runArtifact.id),
              parents: [folderId],
              mimeType: 'application/json',
            },
            media: {
              mimeType: 'application/json',
              body: JSON.stringify(runArtifact, null, 2),
            },
            fields: 'id',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return {
    runId: runArtifact.id,
    fileId: response.data.id ?? '',
  };
};

const readRunArtifactByFileId = async (drive: drive_v3.Drive, fileId: string): Promise<SelectionSetRunArtifact | null> => {
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get(
          {
            fileId,
            alt: 'media',
          },
          { responseType: 'arraybuffer', signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const parsed = parseJson(response.data);
  return isSelectionSetRunArtifact(parsed) ? parsed : null;
};

const findRunArtifactFile = async (
  drive: drive_v3.Drive,
  folderId: string,
  runId: string,
): Promise<{ id: string } | null> => {
  const listing = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name='${toRunArtifactFileName(runId)}'`,
            fields: 'files(id)',
            pageSize: 1,
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const file = listing.data.files?.[0];
  if (!file?.id) {
    return null;
  }

  return { id: file.id };
};

export const readRunArtifact = async (
  drive: drive_v3.Drive,
  folderId: string,
  runId: string,
): Promise<SelectionSetRunArtifact | null> => {
  const file = await findRunArtifactFile(drive, folderId, runId);
  if (!file) {
    return null;
  }

  return readRunArtifactByFileId(drive, file.id);
};

export type RunArtifactPatch = {
  finishedAt?: string | null;
  result?: Partial<SelectionSetRunArtifact['result']>;
  items?: Partial<SelectionSetRunArtifact['items']>;
};

export const updateRunArtifact = async (
  drive: drive_v3.Drive,
  folderId: string,
  runId: string,
  patch: RunArtifactPatch,
): Promise<SelectionSetRunArtifact | null> => {
  const file = await findRunArtifactFile(drive, folderId, runId);
  if (!file) {
    return null;
  }

  const current = await readRunArtifactByFileId(drive, file.id);
  if (!current) {
    return null;
  }

  const next = {
    ...current,
    ...patch,
    result: {
      ...current.result,
      ...(patch.result ?? {}),
    },
    items: {
      ...current.items,
      ...(patch.items ?? {}),
    },
  } satisfies SelectionSetRunArtifact;

  await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.update(
          {
            fileId: file.id,
            media: {
              mimeType: 'application/json',
              body: JSON.stringify(next, null, 2),
            },
            fields: 'id',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return next;
};

export const listRunArtifacts = async (
  drive: drive_v3.Drive,
  folderId: string,
  options: ListRunArtifactOptions = {},
): Promise<SelectionSetRunArtifact[]> => {
  const listing = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name contains 'Run-'`,
            fields: 'files(id)',
            orderBy: 'modifiedTime desc',
            pageSize: Math.min(Math.max(options.limit ?? 10, 1), 50),
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const files = listing.data.files ?? [];
  const runs = await Promise.all(
    files
      .filter((file): file is { id: string } => typeof file.id === 'string')
      .map((file) => readRunArtifactByFileId(drive, file.id)),
  );

  return runs
    .filter((run): run is SelectionSetRunArtifact => Boolean(run))
    .sort((a, b) => {
      const left = new Date(b.finishedAt ?? b.startedAt).getTime();
      const right = new Date(a.finishedAt ?? a.startedAt).getTime();
      return left - right;
    })
    .slice(0, options.limit ?? 10);
};
