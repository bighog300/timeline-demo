import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);

describe('GET /api/timeline/search', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/timeline/search?q=alpha') as never,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'reconnect_required' });
  });

  it('returns query_too_short for short queries', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await GET(
      new Request('http://localhost/api/timeline/search?q=a') as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'query_too_short' });
  });
});
