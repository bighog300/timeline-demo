import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from './[...nextauth]';

const createResponse = () => {
  const res = {
    statusCode: 200,
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as NextApiResponse;

  res.status = vi.fn().mockImplementation((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  });

  res.json = vi.fn().mockImplementation(() => res);

  return res;
};

describe('pages/api/auth/[...nextauth]', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns not_configured when required env vars are missing', async () => {
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const req = {} as NextApiRequest;
    const res = createResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'not_configured' });
  });
});

export default function testRouteHandler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(404).end();
}
