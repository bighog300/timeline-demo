import { randomUUID } from 'crypto';

import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';

export type GmailSelectionSetDatePreset = '7d' | '30d' | '90d' | 'custom';

export type GmailSelectionSet = {
  kind: 'gmail_selection_set';
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source: 'gmail';
  query: {
    q: string;
    senders: string[];
    datePreset: GmailSelectionSetDatePreset;
    customAfter: string | null;
    hasAttachment: boolean;
    freeText: string;
  };
};

export type GmailSelectionSetMetadata = {
  id: string;
  title: string;
  updatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isValidEmail = (value: string) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);

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

const normalizeCustomAfter = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const normalizeDatePreset = (value: unknown): GmailSelectionSetDatePreset => {
  if (value === '7d' || value === '30d' || value === '90d' || value === 'custom') {
    return value;
  }

  return '30d';
};

const toFileName = (id: string) => `SelectionSet-${id}.json`;

export const buildGmailSelectionSet = (payload: {
  id?: string;
  title: string;
  nowISO: string;
  query: {
    q: string;
    senders: string[];
    datePreset: GmailSelectionSetDatePreset;
    customAfter: string | null;
    hasAttachment: boolean;
    freeText: string;
  };
}): GmailSelectionSet => ({
  kind: 'gmail_selection_set',
  version: 1,
  id: payload.id ?? randomUUID(),
  title: payload.title.trim() || 'Untitled Gmail search',
  createdAt: payload.nowISO,
  updatedAt: payload.nowISO,
  source: 'gmail',
  query: {
    q: payload.query.q.trim(),
    senders: Array.from(
      new Set(
        payload.query.senders
          .map((sender) => sender.trim().toLowerCase())
          .filter((sender) => sender && isValidEmail(sender)),
      ),
    ),
    datePreset: normalizeDatePreset(payload.query.datePreset),
    customAfter: normalizeCustomAfter(payload.query.customAfter),
    hasAttachment: Boolean(payload.query.hasAttachment),
    freeText: payload.query.freeText.trim(),
  },
});

export const isGmailSelectionSet = (value: unknown): value is GmailSelectionSet => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.kind !== 'gmail_selection_set' ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    value.source !== 'gmail' ||
    !isRecord(value.query)
  ) {
    return false;
  }

  const query = value.query;

  return (
    typeof query.q === 'string' &&
    Array.isArray(query.senders) &&
    query.senders.every((sender) => typeof sender === 'string') &&
    (query.datePreset === '7d' ||
      query.datePreset === '30d' ||
      query.datePreset === '90d' ||
      query.datePreset === 'custom') &&
    (query.customAfter === null || typeof query.customAfter === 'string') &&
    typeof query.hasAttachment === 'boolean' &&
    typeof query.freeText === 'string'
  );
};

export const writeGmailSelectionSetToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  selectionSet: GmailSelectionSet,
) => {
  const payload = JSON.stringify(selectionSet, null, 2);
  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: {
              name: toFileName(selectionSet.id),
              parents: [folderId],
              mimeType: 'application/json',
            },
            media: {
              mimeType: 'application/json',
              body: payload,
            },
            fields: 'id, modifiedTime',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return {
    driveFileId: response.data.id ?? '',
    modifiedTime: response.data.modifiedTime ?? selectionSet.updatedAt,
  };
};

const readSelectionSetByDriveFileId = async (drive: drive_v3.Drive, fileId: string) => {
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

  return parseJson(response.data);
};

export const readGmailSelectionSetFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  id: string,
): Promise<GmailSelectionSet | null> => {
  const listing = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name='${toFileName(id)}'`,
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

  const fileId = listing.data.files?.[0]?.id;
  if (!fileId) {
    return null;
  }

  const parsed = await readSelectionSetByDriveFileId(drive, fileId);
  if (!isGmailSelectionSet(parsed)) {
    return null;
  }

  return parsed;
};

export const listGmailSelectionSetsFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
): Promise<GmailSelectionSetMetadata[]> => {
  const listing = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list(
          {
            q: `'${folderId}' in parents and trashed=false and name contains 'SelectionSet-'`,
            fields: 'files(id, modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 100,
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const files = listing.data.files ?? [];
  const sets = await Promise.all(
    files
      .filter((file): file is { id: string; modifiedTime?: string | null } => typeof file.id === 'string')
      .map(async (file) => {
        const parsed = await readSelectionSetByDriveFileId(drive, file.id);
        if (!isGmailSelectionSet(parsed)) {
          return null;
        }

        return {
          id: parsed.id,
          title: parsed.title,
          updatedAt: parsed.updatedAt || file.modifiedTime || new Date().toISOString(),
        } satisfies GmailSelectionSetMetadata;
      }),
  );

  return sets.filter((set): set is GmailSelectionSetMetadata => Boolean(set));
};
