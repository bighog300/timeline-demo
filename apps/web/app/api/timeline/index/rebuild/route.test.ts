import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);

describe('POST /api/timeline/index/rebuild', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await POST(
      new Request('http://localhost/api/timeline/index/rebuild', {
        method: 'POST',
      }) as never,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'reconnect_required',
        message: 'Reconnect required.',
      },
      error_code: 'reconnect_required',
    });
  });

  it('returns drive_not_provisioned when missing folder', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: null } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await POST(
      new Request('http://localhost/api/timeline/index/rebuild', {
        method: 'POST',
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'drive_not_provisioned',
        message: 'Drive folder not provisioned.',
      },
      error_code: 'drive_not_provisioned',
    });
  });
});
