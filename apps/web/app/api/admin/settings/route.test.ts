import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { GET, PUT } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);

describe('/api/admin/settings', () => {
  it('returns forbidden for non-admin users on GET', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockGetGoogleSession.mockResolvedValue({
      user: { email: 'user@example.com' },
      driveFolderId: 'folder-1',
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await GET(new Request('http://localhost/api/admin/settings') as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'forbidden',
        message: 'Access denied.',
      },
      error_code: 'forbidden',
    });
  });

  it('returns forbidden for non-admin users on PUT', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockGetGoogleSession.mockResolvedValue({
      user: { email: 'user@example.com' },
      driveFolderId: 'folder-1',
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await PUT(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          provider: 'stub',
          model: 'gpt-4o-mini',
          systemPrompt: '',
          maxContextItems: 8,
          temperature: 0.2,
        }),
      }) as never,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'forbidden',
        message: 'Access denied.',
      },
      error_code: 'forbidden',
    });
  });
});
