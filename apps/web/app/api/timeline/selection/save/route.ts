import { randomUUID } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
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
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 30, windowMs: 60_000 });
  if (!rateStatus.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
      retryAfterMs: rateStatus.resetMs,
    });
  }

  let payload: SavePayload = {};
  try {
    payload = (await request.json()) as SavePayload;
  } catch {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  if (!isRecord(payload)) {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  const validated = validatePayload(payload);
  if (!validated.ok) {
    return jsonError(400, 'invalid_request', validated.error);
  }

  const drive = createDriveClient(accessToken);
  const now = new Date().toISOString();
  let selectionSet = buildSelectionSet(validated.payload, session.driveFolderId, now);

  if (validated.payload.driveFileId) {
    let existing;
    try {
      existing = await readSelectionSetFromDrive(
        drive,
        session.driveFolderId,
        validated.payload.driveFileId,
      );
    } catch (error) {
      logGoogleError(error, 'drive.files.get');
      const mapped = mapGoogleError(error, 'drive.files.get');
      return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
    }
    if (!existing) {
      return jsonError(400, 'invalid_request', 'Selection set not found.');
    }

    selectionSet = {
      ...selectionSet,
      id: existing.id,
      createdAtISO: existing.createdAtISO,
      driveFileId: existing.driveFileId,
      driveWebViewLink: existing.driveWebViewLink,
    };
  }

  let writeResult;
  try {
    writeResult = await writeSelectionSetToDrive(drive, session.driveFolderId, selectionSet);
  } catch (error) {
    logGoogleError(error, 'drive.files.create');
    const mapped = mapGoogleError(error, 'drive.files.create');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  const updatedSet = {
    ...selectionSet,
    driveFileId: writeResult.driveFileId,
    driveWebViewLink: writeResult.driveWebViewLink ?? selectionSet.driveWebViewLink,
    updatedAtISO: writeResult.modifiedTime ?? selectionSet.updatedAtISO,
  };

  return NextResponse.json({ set: updatedSet });
};
