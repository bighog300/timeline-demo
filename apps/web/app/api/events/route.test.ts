import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/events', () => {
  it('returns a list of events', async () => {
    const response = await GET();

    expect(response.status).toBe(200);

    const payload = (await response.json()) as Array<{
      id: string;
      title: string;
      start: string;
      end: string;
      venue: string;
      city: string;
      category: string;
      price_range: string;
      url: string;
      tags: string[];
    }>;

    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        start: expect.any(String),
        end: expect.any(String),
        venue: expect.any(String),
        city: expect.any(String),
        category: expect.any(String),
        price_range: expect.any(String),
        url: expect.any(String),
        tags: expect.any(Array),
      }),
    );
  });
});
