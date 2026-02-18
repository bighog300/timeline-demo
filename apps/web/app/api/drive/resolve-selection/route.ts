import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import { MIME_GROUP_SCHEMA, resolveDriveSelection, SCOPE_SCHEMA } from '../../../lib/driveBrowseSelection';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';

const RequestSchema = z
  .object({
    scope: SCOPE_SCHEMA,
    items: z.array(z.object({ id: z.string().trim().min(1), isFolder: z.boolean() }).strict()).min(1),
    mimeGroup: MIME_GROUP_SCHEMA,
    limit: z.number().int().min(1).max(500).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

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
  const dryRun = parsed.data.dryRun ?? true;

  try {
    const resolved = await resolveDriveSelection({
      accessToken,
      driveFolderId: session.driveFolderId,
      scope: parsed.data.scope,
      picked: parsed.data.items,
      mimeGroup: parsed.data.mimeGroup,
      limit,
      dryRun,
    });

    return NextResponse.json(resolved);
  } catch (error) {
    if (error instanceof Error && error.message === 'ITEM_OUTSIDE_APP_SCOPE') {
      return jsonError(403, 'forbidden', 'Item is outside the app Drive scope.');
    }

    logGoogleError(error, 'drive.resolve_selection');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
