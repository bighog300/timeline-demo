import { describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from './fetchWithTimeout';

describe('fetchWithTimeout', () => {
  it('throws with requestId when response is not ok', async () => {
    const response = new Response('nope', {
      status: 503,
      headers: { 'x-request-id': 'req-123' },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    await expect(fetchWithTimeout('https://example.com')).rejects.toMatchObject({
      requestId: 'req-123',
      status: 503,
    });

    globalThis.fetch = originalFetch;
  });
});
