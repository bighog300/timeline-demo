import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/google/drive/list', () => {
  it('returns reconnect_required when not authenticated', async () => {
    const response = await GET(new Request('http://localhost/api/google/drive/list') as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'reconnect_required',
        message: 'Reconnect required.',
      },
      error_code: 'reconnect_required',
    });
  });
});
