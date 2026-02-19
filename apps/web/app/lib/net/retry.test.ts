import { describe, expect, it, vi } from 'vitest';

import { withRetry, type RetryableError } from './retry';

describe('withRetry', () => {
  it('retries on 500 then succeeds', async () => {
    let count = 0;
    const result = await withRetry(
      async () => {
        count += 1;
        if (count < 2) throw { kind: 'http', status: 500, message: 'upstream' } satisfies RetryableError;
        return 'ok';
      },
      { jitter: false, baseDelayMs: 1 },
    );

    expect(result).toMatchObject({ ok: true, attempts: 2, value: 'ok' });
  });

  it('does not retry on 400', async () => {
    let count = 0;
    const result = await withRetry(
      async () => {
        count += 1;
        throw { kind: 'http', status: 400, message: 'bad_request' } satisfies RetryableError;
      },
      { jitter: false, baseDelayMs: 1 },
    );

    expect(result).toMatchObject({ ok: false, attempts: 1, error: { kind: 'http', status: 400 } });
    expect(count).toBe(1);
  });

  it('retries on 429', async () => {
    let count = 0;
    const result = await withRetry(
      async () => {
        count += 1;
        if (count < 3) throw { kind: 'http', status: 429, message: 'rate_limit' } satisfies RetryableError;
        return 'ok';
      },
      { jitter: false, baseDelayMs: 1 },
    );

    expect(result).toMatchObject({ ok: true, attempts: 3, value: 'ok' });
  });

  it('respects maxTotalMs and stops early', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw { kind: 'http', status: 500, message: 'down' } satisfies RetryableError;
    });

    const promise = withRetry(fn, {
      jitter: false,
      baseDelayMs: 100,
      maxDelayMs: 100,
      maxAttempts: 5,
      maxTotalMs: 50,
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toMatchObject({ ok: false, attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
