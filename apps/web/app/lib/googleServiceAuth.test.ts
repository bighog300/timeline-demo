import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getGoogleAccessTokenForCron, refreshGoogleAccessToken } from './googleServiceAuth';

describe('googleServiceAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'client';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = 'refresh';
  });

  it('refreshes token successfully', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 }),
    );

    const result = await refreshGoogleAccessToken('refresh');
    expect(result.ok).toBe(true);
  });

  it('returns missing_refresh_token when not configured', async () => {
    delete process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
    const result = await getGoogleAccessTokenForCron();
    expect(result).toEqual({ ok: false, error: 'missing_refresh_token' });
  });
});
