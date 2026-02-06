import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/health', () => {
  it('returns a healthy response payload', async () => {
    const response = await GET();

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { ok: boolean; service: string; ts: string };

    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('web');
    expect(payload.ts).toEqual(expect.any(String));
  });
});
