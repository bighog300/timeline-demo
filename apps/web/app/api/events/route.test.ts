import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/events', () => {
  it('returns a list of events', async () => {
    const response = await GET();

    expect(response.status).toBe(200);

    const payload = (await response.json()) as Array<{ id: string; title: string }>;

    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
      }),
    );
  });
});
