import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';
import { readRunArtifact, updateRunArtifact, type RunArtifactPatch } from '../../../lib/runArtifacts';

type UpdateRequest = RunArtifactPatch;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

  if (!isRecord(payload)) {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  const typed = payload as UpdateRequest;
  const { id } = await context.params;
  const drive = createDriveClient(accessToken);

  try {
    const updated = await updateRunArtifact(drive, session.driveFolderId, id, {
      finishedAt: typed.finishedAt,
      result: typed.result,
      items: typed.items,
    });

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
