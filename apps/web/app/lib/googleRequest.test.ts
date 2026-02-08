import { describe, expect, it, vi } from 'vitest';

import { mapGoogleError, withRetry, withTimeout } from './googleRequest';

const buildError = (status: number) => {
  const error = new Error('Request failed') as Error & { response?: { status: number } };
  error.response = { status };
  return error;
};

describe('googleRequest withRetry', () => {
  it('retries transient failures', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(buildError(503))
      .mockRejectedValueOnce(buildError(503))
      .mockResolvedValue('ok');

    const promise = withRetry(fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry non-transient failures', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(buildError(400));

    await expect(withRetry(fn)).rejects.toThrow('Request failed');
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('googleRequest withTimeout', () => {
  it('maps timeouts to upstream_timeout', async () => {
    vi.useFakeTimers();
    const promise = withTimeout(
      (signal) =>
        new Promise<string>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          setTimeout(() => resolve('ok'), 50);
        }),
      10,
    );
    const handled = promise.catch((error) => error);

    await vi.runAllTimersAsync();

    const caught = await handled;

    const mapped = mapGoogleError(caught, 'drive.files.list');
    expect(mapped.code).toBe('upstream_timeout');
    expect(mapped.status).toBe(504);
    vi.useRealTimers();
  });
});
