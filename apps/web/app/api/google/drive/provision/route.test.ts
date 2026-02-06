import { describe, expect, it } from 'vitest';

import { POST } from './route';

describe('POST /api/google/drive/provision', () => {
  it('returns reconnect_required when not authenticated', async () => {
    const response = await POST(new Request('http://localhost/api/google/drive/provision') as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'reconnect_required' });
  });
});
