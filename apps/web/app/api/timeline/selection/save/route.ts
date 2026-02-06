import { randomUUID } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';
import type { SelectionSet, SelectionSetItem } from '../../../../lib/types';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';

const MAX_ITEMS = 500;

type SavePayload = {
  name?: string;
  notes?: string;
  items?: SelectionSetItem[];
  driveFileId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validatePayload = (
  payload: SavePayload,
): { ok: true; payload: Required<Pick<SavePayload, 'name' | 'items'>> & SavePayload } | { ok: false; error: string } => {
  if (typeof payload.name !== 'string') {
    return { ok: false, error: 'Name is required.' };
  }

  const name = payload.name.trim();
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: 'Name must be between 1 and 80 characters.' };
  }

  if (!Array.isArray(payload.items)) {
    return { ok: false, error: 'Items are required.' };
  }

  if (payload.items.length > MAX_ITEMS) {
    return { ok: false, error: `Selection set can include up to ${MAX_ITEMS} items.` };
  }

  for (const item of payload.items) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Items must be objects.' };
    }

    if (item.source !== 'gmail' && item.source !== 'drive') {
      return { ok: false, error: 'Items must include a valid source.' };
    }

    if (typeof item.id !== 'string' || !item.id.trim()) {
      return { ok: false, error: 'Items must include an id.' };
    }

    if (item.title !== undefined && typeof item.title !== 'string') {
      return { ok: false, error: 'Item titles must be strings.' };
    }

    if (item.dateISO !== undefined && typeof item.dateISO !== 'string') {
      return { ok: false, error: 'Item dateISO must be strings.' };
    }
  }

  return { ok: true, payload: { ...payload, name, items: payload.items } };
};

const buildSelectionSet = (payload: SavePayload, folderId: string, now: string): SelectionSet => ({
  id: payload.driveFileId ? payload.driveFileId : randomUUID(),
  name: payload.name ?? 'Untitled Selection',
  createdAtISO: now,
  updatedAtISO: now,
  items: payload.items ?? [],
  notes: payload.notes?.trim() || undefined,
  version: 1,
  driveFolderId: folderId,
  driveFileId: payload.driveFileId ?? '',
});

export const POST = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  if (!session.driveFolderId) {
    return NextResponse.json({ error: 'drive_not_provisioned' }, { status: 400 });
  }

  let payload: SavePayload = {};
  try {
    payload = (await request.json()) as SavePayload;
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (!isRecord(payload)) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const validated = validatePayload(payload);
  if (!validated.ok) {
    return NextResponse.json({ error: 'invalid_payload', message: validated.error }, { status: 400 });
  }

  const drive = createDriveClient(accessToken);
  const now = new Date().toISOString();
  let selectionSet = buildSelectionSet(validated.payload, session.driveFolderId, now);

  if (validated.payload.driveFileId) {
    const existing = await readSelectionSetFromDrive(
      drive,
      session.driveFolderId,
      validated.payload.driveFileId,
    );
    if (!existing) {
      return NextResponse.json({ error: 'selection_not_found' }, { status: 404 });
    }

    selectionSet = {
      ...selectionSet,
      id: existing.id,
      createdAtISO: existing.createdAtISO,
      driveFileId: existing.driveFileId,
      driveWebViewLink: existing.driveWebViewLink,
    };
  }

  const writeResult = await writeSelectionSetToDrive(drive, session.driveFolderId, selectionSet);

  const updatedSet = {
    ...selectionSet,
    driveFileId: writeResult.driveFileId,
    driveWebViewLink: writeResult.driveWebViewLink ?? selectionSet.driveWebViewLink,
    updatedAtISO: writeResult.modifiedTime ?? selectionSet.updatedAtISO,
  };

  return NextResponse.json({ set: updatedSet });
};
