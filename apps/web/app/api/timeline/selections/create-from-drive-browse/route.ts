import { randomUUID } from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { DriveSelectionSetJsonSchema, SelectionSetItemSchema } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { MIME_GROUP_SCHEMA, resolveDriveSelection, SCOPE_SCHEMA } from '../../../../lib/driveBrowseSelection';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';

const RequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  scope: SCOPE_SCHEMA,
  picked: z.array(z.object({ id: z.string().trim().min(1), isFolder: z.boolean() }).strict()).min(1),
  mimeGroup: MIME_GROUP_SCHEMA,
  limit: z.number().int().min(1).max(500).optional(),
}).strict();

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
    return jsonError(400, 'bad_request', 'Invalid request payload.');
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(400, 'bad_request', 'Invalid request payload.', parsed.error.flatten());
  }

  const limit = parsed.data.limit ?? 200;

  try {
    const resolved = await resolveDriveSelection({
      accessToken,
      driveFolderId: session.driveFolderId,
      scope: parsed.data.scope,
      picked: parsed.data.picked,
      mimeGroup: parsed.data.mimeGroup,
      limit,
      dryRun: false,
    });

    const nowISO = new Date().toISOString();
    const items = resolved.files
      .slice(0, limit)
      .map((file) =>
        SelectionSetItemSchema.parse({
          source: 'drive',
          id: file.id,
          title: file.name,
          dateISO: file.modifiedTime ?? nowISO,
        }),
      );

    const candidate = {
      id: randomUUID(),
      name: parsed.data.name,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      items,
      version: 1,
      driveFolderId: session.driveFolderId,
      driveFileId: '',
    };

    const validated = DriveSelectionSetJsonSchema.safeParse(candidate);
    if (!validated.success) {
      return jsonError(500, 'internal_error', 'Failed to build selection set payload.');
    }

    const drive = createDriveClient(accessToken);
    const write = await writeSelectionSetToDrive(drive, session.driveFolderId, validated.data);

    return NextResponse.json({
      fileId: write.driveFileId,
      name: parsed.data.name,
      count: items.length,
      truncated: resolved.truncated,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'ITEM_OUTSIDE_APP_SCOPE') {
      return jsonError(403, 'forbidden', 'Item is outside the app Drive scope.');
    }

    logGoogleError(error, 'drive.files.create');
    const mapped = mapGoogleError(error, 'drive.files.create');
    if (mapped.status >= 500) {
      return jsonError(500, 'internal_error', 'Failed to create saved selection.');
    }

    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
