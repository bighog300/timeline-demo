import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);

describe('POST /api/timeline/summarize', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await POST(new Request('http://localhost/api/timeline/summarize') as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'reconnect_required' });
  });

  it('returns drive_not_provisioned when session has no folder', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: undefined } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize', {
        method: 'POST',
        body: JSON.stringify({ items: [{ source: 'gmail', id: 'id-1' }] }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'drive_not_provisioned' });
  });
});
