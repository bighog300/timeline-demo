import { NextResponse } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';
import { deleteSelectionSet, readSelectionSetFromDrive, updateSelectionSetTitle } from '../../../lib/selectionSets';

const MAX_TITLE_LENGTH = 120;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const { id: rawId } = await params;
  const id = rawId?.trim();
  if (!id) {
    return jsonError(400, 'invalid_request', 'Saved search id is required.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const set = await readSelectionSetFromDrive(drive, session.driveFolderId, id);
    if (!set) {
      return jsonError(404, 'invalid_request', 'Saved search not found.');
    }

    return NextResponse.json({ set });
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const { id: rawId } = await params;
  const id = rawId?.trim();
  if (!id) {
    return jsonError(400, 'invalid_request', 'Saved search id is required.');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  if (!isRecord(payload) || typeof payload.title !== 'string') {
    return jsonError(400, 'invalid_request', 'Title is required.');
  }

  const title = payload.title.trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return jsonError(400, 'invalid_request', 'Title must be 1 to 120 characters.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const set = await updateSelectionSetTitle(drive, session.driveFolderId, id, title);
    if (!set) {
      return jsonError(404, 'invalid_request', 'Saved search not found.');
    }

    return NextResponse.json({
      id: set.id,
      title: set.title,
      updatedAt: set.updatedAt,
      kind: set.kind,
      source: set.source,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.update');
    const mapped = mapGoogleError(error, 'drive.files.update');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const { id: rawId } = await params;
  const id = rawId?.trim();
  if (!id) {
    return jsonError(400, 'invalid_request', 'Saved search id is required.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const deleted = await deleteSelectionSet(drive, session.driveFolderId, id);
    if (!deleted) {
      return jsonError(404, 'invalid_request', 'Saved search not found.');
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logGoogleError(error, 'drive.files.delete');
    const mapped = mapGoogleError(error, 'drive.files.delete');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
}
