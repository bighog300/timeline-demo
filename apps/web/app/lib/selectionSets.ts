import { randomUUID } from 'crypto';

import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';

export type GmailSelectionSetDatePreset = '7d' | '30d' | '90d' | 'custom';
export type DriveSelectionSetModifiedPreset = '7d' | '30d' | '90d' | 'custom';
export type DriveSelectionSetMimeGroup = 'any' | 'pdf' | 'doc' | 'sheet' | 'slide' | 'image' | 'folder';

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

export type DriveSelectionSet = {
  kind: 'drive_selection_set';
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source: 'drive';
  query: {
    q: string;
    nameContains: string;
    mimeGroup: DriveSelectionSetMimeGroup;
    modifiedPreset: DriveSelectionSetModifiedPreset;
    modifiedAfter: string | null;
    inFolderId: string | null;
    ownerEmail: string | null;
  };
};

export type SelectionSet = GmailSelectionSet | DriveSelectionSet;

export type SelectionSetMetadata = {
  id: string;
  title: string;
  updatedAt: string;
  kind: SelectionSet['kind'];
  source: SelectionSet['source'];
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

const normalizeDriveMimeGroup = (value: unknown): DriveSelectionSetMimeGroup => {
  if (
    value === 'any' ||
    value === 'pdf' ||
    value === 'doc' ||
    value === 'sheet' ||
    value === 'slide' ||
    value === 'image' ||
    value === 'folder'
  ) {
    return value;
  }

  return 'any';
};

const normalizeDriveModifiedPreset = (value: unknown): DriveSelectionSetModifiedPreset => {
  if (value === '7d' || value === '30d' || value === '90d' || value === 'custom') {
    return value;
  }

  return '30d';
};

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
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

export const buildDriveSelectionSet = (payload: {
  id?: string;
  title: string;
  nowISO: string;
  query: {
    q: string;
    nameContains: string;
    mimeGroup: DriveSelectionSetMimeGroup;
    modifiedPreset: DriveSelectionSetModifiedPreset;
    modifiedAfter: string | null;
    inFolderId: string | null;
    ownerEmail: string | null;
  };
}): DriveSelectionSet => ({
  kind: 'drive_selection_set',
  version: 1,
  id: payload.id ?? randomUUID(),
  title: payload.title.trim() || 'Untitled Drive search',
  createdAt: payload.nowISO,
  updatedAt: payload.nowISO,
  source: 'drive',
  query: {
    q: payload.query.q.trim(),
    nameContains: payload.query.nameContains.trim(),
    mimeGroup: normalizeDriveMimeGroup(payload.query.mimeGroup),
    modifiedPreset: normalizeDriveModifiedPreset(payload.query.modifiedPreset),
    modifiedAfter: normalizeCustomAfter(payload.query.modifiedAfter),
    inFolderId: normalizeOptionalString(payload.query.inFolderId),
    ownerEmail: normalizeOptionalString(payload.query.ownerEmail)?.toLowerCase() ?? null,
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

export const isDriveSelectionSet = (value: unknown): value is DriveSelectionSet => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.kind !== 'drive_selection_set' ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    value.source !== 'drive' ||
    !isRecord(value.query)
  ) {
    return false;
  }

  const query = value.query;

  return (
    typeof query.q === 'string' &&
    typeof query.nameContains === 'string' &&
    (query.mimeGroup === 'any' ||
      query.mimeGroup === 'pdf' ||
      query.mimeGroup === 'doc' ||
      query.mimeGroup === 'sheet' ||
      query.mimeGroup === 'slide' ||
      query.mimeGroup === 'image' ||
      query.mimeGroup === 'folder') &&
    (query.modifiedPreset === '7d' ||
      query.modifiedPreset === '30d' ||
      query.modifiedPreset === '90d' ||
      query.modifiedPreset === 'custom') &&
    (query.modifiedAfter === null || typeof query.modifiedAfter === 'string') &&
    (query.inFolderId === null || typeof query.inFolderId === 'string') &&
    (query.ownerEmail === null || typeof query.ownerEmail === 'string')
  );
};

const isSelectionSet = (value: unknown): value is SelectionSet =>
  isGmailSelectionSet(value) || isDriveSelectionSet(value);

export const writeSelectionSetToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  selectionSet: SelectionSet,
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

export const writeGmailSelectionSetToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  selectionSet: GmailSelectionSet,
) => writeSelectionSetToDrive(drive, folderId, selectionSet);

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

export const readSelectionSetFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  id: string,
): Promise<SelectionSet | null> => {
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
  if (!isSelectionSet(parsed)) {
    return null;
  }

  return parsed;
};

export const readGmailSelectionSetFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  id: string,
): Promise<GmailSelectionSet | null> => {
  const parsed = await readSelectionSetFromDrive(drive, folderId, id);
  return parsed && isGmailSelectionSet(parsed) ? parsed : null;
};

export const listSelectionSetsFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
): Promise<SelectionSetMetadata[]> => {
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
        if (!isSelectionSet(parsed)) {
          return null;
        }

        return {
          id: parsed.id,
          title: parsed.title,
          updatedAt: parsed.updatedAt || file.modifiedTime || new Date().toISOString(),
          kind: parsed.kind,
          source: parsed.source,
        } satisfies SelectionSetMetadata;
      }),
  );

  return sets.filter((set): set is SelectionSetMetadata => Boolean(set));
};

export const listGmailSelectionSetsFromDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
): Promise<Array<{ id: string; title: string; updatedAt: string }>> => {
  const sets = await listSelectionSetsFromDrive(drive, folderId);
  return sets
    .filter((set) => set.kind === 'gmail_selection_set')
    .map((set) => ({ id: set.id, title: set.title, updatedAt: set.updatedAt }));
};
