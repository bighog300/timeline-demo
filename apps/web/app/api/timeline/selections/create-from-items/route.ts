import { randomUUID } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { DriveSelectionSetJsonSchema } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';

const MAX_ITEMS = 200;

const RequestSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    source: z.literal('drive'),
    items: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            name: z.string().trim().min(1).optional(),
            mimeType: z.string().trim().min(1).optional(),
            modifiedTime: z.string().trim().min(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ITEMS),
  })
  .strict();

const parseDateISO = (value?: string) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : undefined;
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
    return jsonError(400, 'bad_request', 'Invalid request payload.');
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(400, 'bad_request', 'Invalid request payload.', parsed.error.flatten());
  }

  const nowISO = new Date().toISOString();
  const normalizedItems = parsed.data.items.map((item) => ({
    source: 'drive' as const,
    id: item.id,
    title: item.name || '(untitled)',
    dateISO: parseDateISO(item.modifiedTime) ?? nowISO,
  }));

  const selectionSetCandidate = {
    id: randomUUID(),
    name: parsed.data.name,
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    items: normalizedItems,
    version: 1,
    driveFolderId: session.driveFolderId,
    driveFileId: '',
  };

  const validated = DriveSelectionSetJsonSchema.safeParse(selectionSetCandidate);
  if (!validated.success) {
    return jsonError(500, 'internal_error', 'Failed to build selection set payload.');
  }

  try {
    const drive = createDriveClient(accessToken);
    const write = await writeSelectionSetToDrive(drive, session.driveFolderId, validated.data);

    return NextResponse.json({
      fileId: write.driveFileId,
      name: parsed.data.name,
      count: normalizedItems.length,
      webViewLink: write.driveWebViewLink ?? '',
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.create');
    const mapped = mapGoogleError(error, 'drive.files.create');
    if (mapped.status >= 500) {
      return jsonError(500, 'internal_error', 'Failed to create saved selection.');
    }
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
