import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/calendar', () => {
  it('returns calendar items', async () => {
    const response = await GET();

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      items: Array<{ id: string; title: string; start: string; end: string; location: string }>;
    };

    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        start: expect.any(String),
        end: expect.any(String),
        location: expect.any(String),
      }),
    );
  });
});
