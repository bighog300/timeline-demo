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
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'reconnect_required',
        message: 'Reconnect required.',
      },
      error_code: 'reconnect_required',
    });
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
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'drive_not_provisioned',
        message: 'Drive folder not provisioned.',
      },
      error_code: 'drive_not_provisioned',
    });
  });

  it('returns too_many_items when over the cap', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await POST(
      new Request('http://localhost/api/timeline/summarize', {
        method: 'POST',
        body: JSON.stringify({
          items: Array.from({ length: 11 }, (_, index) => ({
            source: 'gmail',
            id: `id-${index}`,
          })),
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'too_many_items',
        message: 'Too many items requested.',
        details: {
          limit: 10,
        },
      },
      error_code: 'too_many_items',
    });
  });
});
