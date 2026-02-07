import { randomUUID } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { OutsideFolderError, PayloadLimitError } from '../../../../lib/driveSafety';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';
import type { SelectionSet, SelectionSetItem } from '../../../../lib/types';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

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
  const ctx = createCtx(request, '/api/timeline/selection/save');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  const driveFolderId = session.driveFolderId;
  if (!driveFolderId) {
    return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 30, windowMs: 60_000 }, ctx);
  if (!rateStatus.allowed) {
    return respond(
      jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
        retryAfterMs: rateStatus.resetMs,
      }),
    );
  }

  let payload: SavePayload = {};
  try {
    payload = (await request.json()) as SavePayload;
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  if (!isRecord(payload)) {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const validated = validatePayload(payload);
  if (!validated.ok) {
    return respond(jsonError(400, 'invalid_request', validated.error));
  }

  logInfo(ctx, 'selection_set_save', {
    items: validated.payload.items.length,
    update: Boolean(validated.payload.driveFileId),
  });

  const drive = createDriveClient(accessToken);
  const now = new Date().toISOString();
  let selectionSet = buildSelectionSet(validated.payload, driveFolderId, now);

  const existingDriveFileId = validated.payload.driveFileId;
  if (existingDriveFileId) {
    let existing;
    try {
      existing = await time(ctx, 'drive.files.get.selection_set', () =>
        readSelectionSetFromDrive(drive, driveFolderId, existingDriveFileId, ctx),
      );
    } catch (error) {
      if (error instanceof OutsideFolderError) {
        return respond(
          jsonError(
            403,
            'forbidden_outside_folder',
            'Selection set is outside the app folder.',
          ),
        );
      }
      logGoogleError(error, 'drive.files.get', ctx);
      const mapped = mapGoogleError(error, 'drive.files.get');
      logError(ctx, 'request_error', {
        status: mapped.status,
        code: mapped.code,
        error: safeError(error),
      });
      return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
    }
    if (!existing) {
      return respond(jsonError(400, 'invalid_request', 'Selection set not found.'));
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
    writeResult = await writeSelectionSetToDrive(drive, driveFolderId, selectionSet, ctx);
  } catch (error) {
    if (error instanceof PayloadLimitError) {
      return respond(
        jsonError(
          400,
          'invalid_request',
          `${error.label} is too large to store in Drive. Reduce the selection size and try again.`,
        ),
      );
    }
    logGoogleError(error, 'drive.files.create', ctx);
    const mapped = mapGoogleError(error, 'drive.files.create');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  const updatedSet = {
    ...selectionSet,
    driveFileId: writeResult.driveFileId,
    driveWebViewLink: writeResult.driveWebViewLink ?? selectionSet.driveWebViewLink,
    updatedAtISO: writeResult.modifiedTime ?? selectionSet.updatedAtISO,
  };

  return respond(NextResponse.json({ set: updatedSet }));
};
