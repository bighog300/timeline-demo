import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../../lib/apiErrors';
import {
  getSelectionFileMetadata,
  readDriveSelectionJson,
  SELECTION_FILE_SUFFIX,
} from '../../../../../lib/driveSelections';
import { sanitizeDriveFileName } from '../../../../../lib/driveSafety';
import { getGoogleAccessToken, getGoogleSession } from '../../../../../lib/googleAuth';
import { createDriveClient } from '../../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../../lib/googleRequest';
import { isOwnedByFolder, updateSelectionFile } from '../../../../../lib/selectionFileOps';

export const PATCH = async (request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken || !session.driveFolderId) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'bad_request', 'Invalid request body.');
  }

  const rawName =
    body && typeof body === 'object' && 'name' in body && typeof body.name === 'string'
      ? body.name.trim()
      : '';

  if (rawName.length < 2 || rawName.length > 60) {
    return jsonError(400, 'bad_request', 'Name must be between 2 and 60 characters.');
  }

  const sanitizedName = sanitizeDriveFileName(rawName, 'Untitled Selection').slice(0, 60).trim();
  if (sanitizedName.length < 2) {
    return jsonError(400, 'bad_request', 'Name must be between 2 and 60 characters.');
  }

  const drive = createDriveClient(accessToken);

  try {
    const { fileId } = await params;
    const metadata = await getSelectionFileMetadata(drive, fileId);
    if (!metadata.data.id) {
      return jsonError(404, 'not_found', 'Selection set not found.');
    }

    if (!isOwnedByFolder(metadata.data.parents, session.driveFolderId)) {
      return jsonError(403, 'forbidden', 'Selection set is outside the app folder.');
    }

    const parsed = await readDriveSelectionJson(drive, fileId);
    if (!parsed) {
      return jsonError(400, 'bad_request', 'Selection file is invalid JSON.');
    }

    const now = new Date().toISOString();
    const nextPayload = {
      ...parsed,
      name: sanitizedName,
      updatedAtISO: now,
    };

    const nextFileName = `${sanitizedName}${SELECTION_FILE_SUFFIX}`;
    const update = await updateSelectionFile(
      drive,
      fileId,
      nextFileName,
      JSON.stringify(nextPayload, null, 2),
    );

    return NextResponse.json({
      fileId: update.data.id ?? fileId,
      name: update.data.name ?? nextFileName,
      webViewLink: update.data.webViewLink ?? undefined,
      modifiedTime: update.data.modifiedTime ?? now,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.update');
    const mapped = mapGoogleError(error, 'drive.files.update');
    if (mapped.status === 404) {
      return jsonError(404, 'not_found', 'Selection set not found.');
    }
    return jsonError(500, 'internal_error', 'Failed to rename selection set.');
  }
};
