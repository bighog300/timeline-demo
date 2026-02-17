import { describe, expect, it, vi, afterEach } from 'vitest';

import { rebuildIndex } from './rebuildIndexClient';

describe('rebuildIndex', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok on successful rebuild', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(rebuildIndex()).resolves.toEqual({ ok: true });
  });

  it('returns parsed ApiError payload on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'internal_error', message: 'Index rebuild failed.' },
            error_code: 'internal_error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    await expect(rebuildIndex()).resolves.toEqual({
      ok: false,
      code: 'internal_error',
      message: 'Index rebuild failed.',
    });
  });

  it('returns generic status error for non-json failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('server exploded', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        }),
      ),
    );

    await expect(rebuildIndex()).resolves.toEqual({
      ok: false,
      message: 'Rebuild failed (status 500).',
    });
  });
});
