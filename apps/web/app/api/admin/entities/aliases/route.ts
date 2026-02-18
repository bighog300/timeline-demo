import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { isAdminSession } from '../../../../lib/adminAuth';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { hashUserHint, logError, logInfo, safeError } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';
import {
  EntityAliasesSchema,
  defaultEntityAliases,
  findEntityAliasesFile,
  normalizeEntityAliases,
  writeEntityAliasesToDrive,
  readEntityAliasesFromDrive,
} from '../../../../lib/entities/aliases';

const PutBodySchema = z.object({ aliases: EntityAliasesSchema.shape.aliases }).strict();

const makeRespond = (request: NextRequest, path: string) => {
  const ctx = createCtx(request, path);
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };
  return { ctx, respond };
};

export const GET = async (request: NextRequest) => {
  const { ctx, respond } = makeRespond(request, '/api/admin/entities/aliases');
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  if (!isAdminSession(session)) return respond(jsonError(403, 'forbidden', 'Access denied.'));
  if (!session.driveFolderId) return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';
  const drive = createDriveClient(accessToken);

  try {
    const loaded = await readEntityAliasesFromDrive(drive, session.driveFolderId, ctx);
    if (!loaded.fileId) {
      const created = await writeEntityAliasesToDrive(drive, session.driveFolderId, null, defaultEntityAliases(), ctx);
      return respond(NextResponse.json({ aliases: defaultEntityAliases(), driveFileId: created.fileId, driveWebViewLink: created.webViewLink }));
    }

    return respond(NextResponse.json({ aliases: loaded.aliases, driveFileId: loaded.fileId, driveWebViewLink: loaded.webViewLink }));
  } catch (error) {
    logError(ctx, 'request_error', { error: safeError(error) });
    return respond(jsonError(500, 'upstream_error', 'Unable to load aliases.'));
  }
};

export const PUT = async (request: NextRequest) => {
  const { ctx, respond } = makeRespond(request, '/api/admin/entities/aliases');
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  if (!isAdminSession(session)) return respond(jsonError(403, 'forbidden', 'Access denied.'));
  if (!session.driveFolderId) return respond(jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.'));

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));
  }

  const parsed = PutBodySchema.safeParse(raw);
  if (!parsed.success) return respond(jsonError(400, 'invalid_request', 'Invalid request payload.'));

  const normalized = normalizeEntityAliases({ version: 1, updatedAtISO: new Date().toISOString(), aliases: parsed.data.aliases });
  if (!normalized) return respond(jsonError(400, 'invalid_request', 'Invalid alias list.'));

  const drive = createDriveClient(accessToken);
  try {
    const existing = await findEntityAliasesFile(drive, session.driveFolderId, ctx);
    const persisted = await writeEntityAliasesToDrive(drive, session.driveFolderId, existing?.id ?? null, normalized, ctx);
    return respond(NextResponse.json({ aliases: normalized, driveFileId: persisted.fileId, driveWebViewLink: persisted.webViewLink ?? existing?.webViewLink }));
  } catch (error) {
    logError(ctx, 'request_error', { error: safeError(error) });
    return respond(jsonError(500, 'upstream_error', 'Unable to persist aliases.'));
  }
};
