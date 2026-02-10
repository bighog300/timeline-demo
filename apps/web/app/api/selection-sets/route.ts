import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createDriveClient } from '../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../lib/googleRequest';
import {
  buildDriveSelectionSet,
  buildGmailSelectionSet,
  listSelectionSetsFromDrive,
  writeSelectionSetToDrive,
  type DriveSelectionSetMimeGroup,
  type DriveSelectionSetModifiedPreset,
  type GmailSelectionSetDatePreset,
} from '../../lib/selectionSets';

type CreateSelectionSetRequest = {
  source?: 'gmail' | 'drive';
  title?: string;
  query?: {
    q?: string;
    senders?: string[];
    datePreset?: GmailSelectionSetDatePreset;
    customAfter?: string | null;
    hasAttachment?: boolean;
    freeText?: string;
    nameContains?: string;
    mimeGroup?: DriveSelectionSetMimeGroup;
    modifiedPreset?: DriveSelectionSetModifiedPreset;
    modifiedAfter?: string | null;
    inFolderId?: string | null;
    ownerEmail?: string | null;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validateRequest = (value: unknown): { ok: true; payload: CreateSelectionSetRequest } | { ok: false; message: string } => {
  if (!isRecord(value)) {
    return { ok: false, message: 'Invalid request payload.' };
  }

  const title = value.title;
  const query = value.query;
  const source = value.source === 'drive' ? 'drive' : 'gmail';

  if (typeof title !== 'string' || !title.trim()) {
    return { ok: false, message: 'Title is required.' };
  }

  if (!isRecord(query)) {
    return { ok: false, message: 'Query is required.' };
  }

  if (typeof query.q !== 'string' || !query.q.trim()) {
    return { ok: false, message: 'Query string is required.' };
  }

  if (source === 'gmail') {
    if (!Array.isArray(query.senders) || query.senders.some((sender) => typeof sender !== 'string')) {
      return { ok: false, message: 'Senders must be a string array.' };
    }

    if (typeof query.hasAttachment !== 'boolean') {
      return { ok: false, message: 'hasAttachment is required.' };
    }

    if (typeof query.freeText !== 'string') {
      return { ok: false, message: 'freeText is required.' };
    }
  }

  return { ok: true, payload: { ...(value as CreateSelectionSetRequest), source } };
};

export const POST = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  const validated = validateRequest(payload);
  if (!validated.ok) {
    return jsonError(400, 'invalid_request', validated.message);
  }

  const drive = createDriveClient(accessToken);
  const nowISO = new Date().toISOString();
  const query = validated.payload.query ?? {};
  const source = validated.payload.source ?? 'gmail';
  const set =
    source === 'drive'
      ? buildDriveSelectionSet({
          title: validated.payload.title ?? 'Untitled Drive search',
          nowISO,
          query: {
            q: query.q ?? '',
            nameContains: query.nameContains ?? '',
            mimeGroup: query.mimeGroup ?? 'any',
            modifiedPreset: query.modifiedPreset ?? '30d',
            modifiedAfter: query.modifiedAfter ?? null,
            inFolderId: query.inFolderId ?? null,
            ownerEmail: query.ownerEmail ?? null,
          },
        })
      : buildGmailSelectionSet({
          title: validated.payload.title ?? 'Untitled Gmail search',
          nowISO,
          query: {
            q: query.q ?? '',
            senders: query.senders ?? [],
            datePreset: query.datePreset ?? '30d',
            customAfter: query.customAfter ?? null,
            hasAttachment: Boolean(query.hasAttachment),
            freeText: query.freeText ?? '',
          },
        });

  try {
    const write = await writeSelectionSetToDrive(drive, session.driveFolderId, set);
    return NextResponse.json({
      id: set.id,
      title: set.title,
      updatedAt: write.modifiedTime,
      driveFileId: write.driveFileId,
      kind: set.kind,
      source: set.source,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.create');
    const mapped = mapGoogleError(error, 'drive.files.create');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};

export const GET = async () => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const sets = await listSelectionSetsFromDrive(drive, session.driveFolderId);
    return NextResponse.json({ sets });
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
