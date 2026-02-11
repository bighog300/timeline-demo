import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';
import { readRunArtifact, updateRunArtifact, type RunArtifactPatch } from '../../../lib/runArtifacts';

type UpdateRequest = RunArtifactPatch;

type ValidatedRunPatch = {
  finishedAt?: string | null;
  result?: {
    status: 'success' | 'partial_success' | 'failed';
    foundCount?: number;
    processedCount?: number;
    failedCount?: number;
    requestIds?: string[];
    note?: string | null;
  };
  items?: {
    ids: null;
    idsIncluded: false;
  };
};

const MAX_RESULT_COUNT = 1000;
const MAX_REQUEST_IDS = 10;
const MAX_REQUEST_ID_LENGTH = 80;
const MAX_NOTE_LENGTH = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isIsoDateString = (value: string) => !Number.isNaN(new Date(value).getTime());

const validateBoundedCount = (value: unknown, maxCount: number) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maxCount;

const validateRunPatch = (
  payload: unknown,
  maxCount: number,
): { valid: true; patch: ValidatedRunPatch } | { valid: false } => {
  if (!isRecord(payload)) {
    return { valid: false };
  }

  const allowedTopLevelKeys = new Set(['finishedAt', 'result', 'items']);
  for (const key of Object.keys(payload)) {
    if (!allowedTopLevelKeys.has(key)) {
      return { valid: false };
    }
  }

  const patch: ValidatedRunPatch = {};

  if ('finishedAt' in payload) {
    if (payload.finishedAt !== null && (typeof payload.finishedAt !== 'string' || !isIsoDateString(payload.finishedAt))) {
      return { valid: false };
    }
    patch.finishedAt = payload.finishedAt;
  }

  if ('result' in payload) {
    if (!isRecord(payload.result) || typeof payload.result.status !== 'string') {
      return { valid: false };
    }

    const allowedResultKeys = new Set([
      'status',
      'foundCount',
      'processedCount',
      'failedCount',
      'requestIds',
      'note',
    ]);

    for (const key of Object.keys(payload.result)) {
      if (!allowedResultKeys.has(key)) {
        return { valid: false };
      }
    }

    if (!['success', 'partial_success', 'failed'].includes(payload.result.status)) {
      return { valid: false };
    }

    const status = payload.result.status as 'success' | 'partial_success' | 'failed';
    const result: NonNullable<ValidatedRunPatch['result']> = {
      status,
    };

    if ('foundCount' in payload.result) {
      if (!validateBoundedCount(payload.result.foundCount, maxCount)) {
        return { valid: false };
      }
      result.foundCount = payload.result.foundCount as number;
    }

    if ('processedCount' in payload.result) {
      if (!validateBoundedCount(payload.result.processedCount, maxCount)) {
        return { valid: false };
      }
      result.processedCount = payload.result.processedCount as number;
    }

    if ('failedCount' in payload.result) {
      if (!validateBoundedCount(payload.result.failedCount, maxCount)) {
        return { valid: false };
      }
      result.failedCount = payload.result.failedCount as number;
    }

    if ('requestIds' in payload.result) {
      if (
        !Array.isArray(payload.result.requestIds) ||
        payload.result.requestIds.length > MAX_REQUEST_IDS ||
        payload.result.requestIds.some(
          (requestId) =>
            typeof requestId !== 'string' || requestId.length < 1 || requestId.length > MAX_REQUEST_ID_LENGTH,
        )
      ) {
        return { valid: false };
      }
      result.requestIds = payload.result.requestIds;
    }

    if ('note' in payload.result) {
      if (
        payload.result.note !== null &&
        (typeof payload.result.note !== 'string' || payload.result.note.length > MAX_NOTE_LENGTH)
      ) {
        return { valid: false };
      }
      result.note = payload.result.note;
    }

    patch.result = result;
  }

  if ('items' in payload) {
    if (!isRecord(payload.items)) {
      return { valid: false };
    }

    const allowedItemsKeys = new Set(['ids', 'idsIncluded']);
    for (const key of Object.keys(payload.items)) {
      if (!allowedItemsKeys.has(key)) {
        return { valid: false };
      }
    }

    if (payload.items.ids !== null || payload.items.idsIncluded !== false) {
      return { valid: false };
    }

    patch.items = {
      ids: null,
      idsIncluded: false,
    };
  }

  return { valid: true, patch };
};

export const GET = async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const { id } = await context.params;
  const drive = createDriveClient(accessToken);

  try {
    const run = await readRunArtifact(drive, session.driveFolderId, id);
    if (!run) {
      return jsonError(404, 'invalid_request', 'Run not found.');
    }

    return NextResponse.json({ run });
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};

export const PATCH = async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
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

  const { id } = await context.params;
  const drive = createDriveClient(accessToken);

  try {
    const current = await readRunArtifact(drive, session.driveFolderId, id);
    if (!current) {
      return jsonError(404, 'invalid_request', 'Run not found.');
    }

    const boundedMaxCount = Math.min(MAX_RESULT_COUNT, current.caps.maxItems * 2);
    const validatedPatch = validateRunPatch(payload, boundedMaxCount);
    if (!validatedPatch.valid) {
      return jsonError(400, 'invalid_request', 'Invalid run patch payload.');
    }

    const safePatch: UpdateRequest = {
      ...(validatedPatch.patch.finishedAt !== undefined ? { finishedAt: validatedPatch.patch.finishedAt } : {}),
      ...(validatedPatch.patch.result ? { result: validatedPatch.patch.result } : {}),
      ...(validatedPatch.patch.items ? { items: validatedPatch.patch.items } : {}),
    };

    const updated = await updateRunArtifact(drive, session.driveFolderId, id, safePatch);

    if (!updated) {
      return jsonError(404, 'invalid_request', 'Run not found.');
    }

    return NextResponse.json({ run: updated });
  } catch (error) {
    logGoogleError(error, 'drive.files.update');
    const mapped = mapGoogleError(error, 'drive.files.update');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
