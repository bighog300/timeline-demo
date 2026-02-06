import { describe, expect, it } from 'vitest';

import { getRequestId, redact, safeError } from './logger';

describe('logger helpers', () => {
  it('getRequestId uses the incoming header when present', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-request-id': 'req-abc' },
    });
    expect(getRequestId(request)).toBe('req-abc');
  });

  it('getRequestId generates a fallback id when header is missing', () => {
    const request = new Request('http://localhost');
    const id = getRequestId(request);
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(4);
  });

  it('redact removes obvious token and email patterns', () => {
    const raw = 'Bearer ya29.ABCD1234 test@example.com access_token=secret';
    const result = redact(raw) as string;
    expect(result).not.toContain('ya29.ABCD1234');
    expect(result).not.toContain('test@example.com');
    expect(result).not.toContain('access_token=secret');
  });

  it('safeError returns a minimal error payload', () => {
    const error = new Error('Boom');
    const payload = safeError(error);
    expect(payload).toEqual({
      name: 'Error',
      message: 'Boom',
    });
  });
});
