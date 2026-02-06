import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);

describe('GET /api/timeline/artifacts/list', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/timeline/artifacts/list') as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'reconnect_required' });
  });
});
