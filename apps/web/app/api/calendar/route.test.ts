import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/calendar', () => {
  it('returns calendar items', async () => {
    const response = await GET();

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { items: unknown[] };

    expect(payload).toEqual({ items: [] });
  });
});
