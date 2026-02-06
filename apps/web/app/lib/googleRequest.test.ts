import { describe, expect, it, vi } from 'vitest';

import { withRetry } from './googleRequest';

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
