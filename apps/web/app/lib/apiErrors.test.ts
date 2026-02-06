import { describe, expect, it } from 'vitest';

import { jsonError, parseApiError } from './apiErrors';

describe('apiErrors helpers', () => {
  it('jsonError returns a standardized payload', async () => {
    const response = jsonError(400, 'invalid_request', 'Invalid payload');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_request',
        message: 'Invalid payload',
      },
      error_code: 'invalid_request',
    });
  });

  it('parseApiError handles standardized errors', async () => {
    const response = jsonError(429, 'rate_limited', 'Too many requests');

    await expect(parseApiError(response)).resolves.toEqual({
      code: 'rate_limited',
      message: 'Too many requests',
      details: undefined,
    });
  });

  it('parseApiError handles legacy errors', async () => {
    const response = new Response(JSON.stringify({ error: 'reconnect_required' }), { status: 401 });

    await expect(parseApiError(response)).resolves.toEqual({
      code: 'reconnect_required',
      message: 'reconnect required',
      details: undefined,
    });
  });
});
