import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);

describe('POST /api/admin/settings/set', () => {
  it('returns forbidden for non-admin users', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockGetGoogleSession.mockResolvedValue({
      user: { email: 'user@example.com' },
      driveFolderId: 'folder-1',
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await POST(
      new Request('http://localhost/api/admin/settings/set', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'stub',
          model: 'gpt-4o-mini',
          systemPrompt: '',
        }),
      }) as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
  });
});
