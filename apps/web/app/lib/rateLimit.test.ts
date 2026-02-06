import { describe, expect, it, vi } from 'vitest';

import { checkRateLimit } from './rateLimit';

describe('rateLimit', () => {
  it('blocks requests over the limit within the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const key = 'user:tester@example.com';
    const config = { limit: 2, windowMs: 60_000 };

    expect(checkRateLimit(key, config).allowed).toBe(true);
    expect(checkRateLimit(key, config).allowed).toBe(true);
    expect(checkRateLimit(key, config).allowed).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(checkRateLimit(key, config).allowed).toBe(true);

    vi.useRealTimers();
  });
});
