import { jsonError } from '../../../../lib/apiErrors';
import { isAdminSession } from '../../../../lib/adminAuth';
import { getGoogleSession } from '../../../../lib/googleAuth';
import { POST as cronPost } from '../../../cron/run/route';

export const POST = async () => {
  const session = await getGoogleSession();
  if (!session) return jsonError(401, 'reconnect_required', 'Reconnect required.');
  if (!isAdminSession(session)) return jsonError(403, 'forbidden', 'Access denied.');

  const request = new Request('http://localhost/api/cron/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
  });
  const response = await cronPost(request as never);
  const json = await response.json();

  return Response.json({
    ok: true,
    skipped: Boolean(json?.skipped),
    reason: json?.reason,
    ranJobs: json?.ranJobs ?? [],
  });
};
