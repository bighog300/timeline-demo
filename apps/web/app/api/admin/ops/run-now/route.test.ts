import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({ getGoogleSession: vi.fn() }));
vi.mock('../../../../lib/adminAuth', () => ({ isAdminSession: vi.fn() }));
vi.mock('../../../cron/run/route', () => ({ POST: vi.fn() }));

import { isAdminSession } from '../../../../lib/adminAuth';
import { getGoogleSession } from '../../../../lib/googleAuth';
import { POST as cronPost } from '../../../cron/run/route';
import { POST } from './route';

describe('/api/admin/ops/run-now', () => {
  it('gates non-admin', async () => {
    vi.mocked(getGoogleSession).mockResolvedValue({ user: { email: 'x@y.com' } } as never);
    vi.mocked(isAdminSession).mockReturnValue(false);
    const response = await POST();
    expect(response.status).toBe(403);
  });

  it('invokes cron route for admin', async () => {
    vi.mocked(getGoogleSession).mockResolvedValue({ user: { email: 'admin@example.com' } } as never);
    vi.mocked(isAdminSession).mockReturnValue(true);
    vi.mocked(cronPost).mockResolvedValue(new Response(JSON.stringify({ ok: true, skipped: true, reason: 'locked' })) as never);
    const response = await POST();
    await expect(response.json()).resolves.toMatchObject({ ok: true, skipped: true, reason: 'locked' });
  });
});
