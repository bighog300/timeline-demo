import { NextResponse } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getSelectionFileMetadata } from '../../../../lib/driveSelections';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import {
  deleteDriveFile,
  findTimelineIndexFile,
  isOwnedByFolder,
  readTimelineIndexJson,
  writeTimelineIndexJson,
} from '../../../../lib/selectionFileOps';

export const DELETE = async (_request: Request, { params }: { params: Promise<{ fileId: string }> }) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken || !session.driveFolderId) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
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

    await deleteDriveFile(drive, fileId);

    const indexFileId = await findTimelineIndexFile(drive, session.driveFolderId);
    if (indexFileId) {
      const index = await readTimelineIndexJson(drive, indexFileId);
      if (index) {
        const selectionSets = index.selectionSets.filter((set) => set.driveFileId !== fileId);
        if (selectionSets.length !== index.selectionSets.length) {
          await writeTimelineIndexJson(drive, indexFileId, {
            ...index,
            selectionSets,
            updatedAtISO: new Date().toISOString(),
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logGoogleError(error, 'drive.files.delete');
    const mapped = mapGoogleError(error, 'drive.files.delete');
    if (mapped.status === 404) {
      return jsonError(404, 'not_found', 'Selection set not found.');
    }
    return jsonError(500, 'internal_error', 'Failed to delete selection set.');
  }
};
