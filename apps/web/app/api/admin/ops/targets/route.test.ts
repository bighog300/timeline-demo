import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({ getGoogleSession: vi.fn(), getGoogleAccessToken: vi.fn() }));
vi.mock('../../../../lib/googleDrive', () => ({ createDriveClient: vi.fn(() => ({})) }));
vi.mock('../../../../lib/notifications/circuitBreaker', () => ({
  loadCircuitBreakers: vi.fn(async () => ({ version: 1, updatedAtISO: '2026-01-01T00:00:00Z', targets: [{ channel: 'slack', targetKey: 'TEAM_A', state: 'muted', failureCount: 3 }] })),
  saveCircuitBreakers: vi.fn(async () => undefined),
  unmuteTarget: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { unmuteTarget } from '../../../../lib/notifications/circuitBreaker';
import { GET, POST } from './route';

const sessionMock = vi.mocked(getGoogleSession);
const tokenMock = vi.mocked(getGoogleAccessToken);

describe('/api/admin/ops/targets', () => {
  it('requires admin auth', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    sessionMock.mockResolvedValue({ user: { email: 'user@example.com' }, driveFolderId: 'folder-1' } as never);
    tokenMock.mockResolvedValue('token');

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('unmutes target', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    sessionMock.mockResolvedValue({ user: { email: 'admin@example.com' }, driveFolderId: 'folder-1' } as never);
    tokenMock.mockResolvedValue('token');

    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'unmute', channel: 'slack', targetKey: 'TEAM_A' }) }));
    expect(response.status).toBe(200);
    expect(unmuteTarget).toHaveBeenCalled();
  });
});
