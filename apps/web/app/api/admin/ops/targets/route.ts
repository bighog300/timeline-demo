import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { isAdminSession } from '../../../../lib/adminAuth';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { loadCircuitBreakers, saveCircuitBreakers, unmuteTarget } from '../../../../lib/notifications/circuitBreaker';

const UnmuteSchema = z.object({
  action: z.literal('unmute'),
  channel: z.enum(['email', 'slack', 'webhook']),
  targetKey: z.string().optional(),
  recipientKey: z.string().optional(),
}).strict();

const authorize = async () => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) return { error: jsonError(401, 'reconnect_required', 'Reconnect required.') };
  if (!isAdminSession(session)) return { error: jsonError(403, 'forbidden', 'Access denied.') };
  if (!session.driveFolderId) return { error: jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.') };

  return { drive: createDriveClient(accessToken), driveFolderId: session.driveFolderId };
};

export const GET = async () => {
  const auth = await authorize();
  if ('error' in auth) return auth.error;

  const state = await loadCircuitBreakers(auth.drive, auth.driveFolderId);
  return Response.json({
    targets: state.targets.filter((target) => target.state === 'muted'),
  });
};

export const POST = async (request: Request) => {
  const auth = await authorize();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = UnmuteSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, 'invalid_request', 'Invalid request body.', parsed.error.flatten());

  const state = await loadCircuitBreakers(auth.drive, auth.driveFolderId);
  unmuteTarget(state, parsed.data);
  await saveCircuitBreakers(auth.drive, auth.driveFolderId, state);

  return Response.json({ ok: true });
};
