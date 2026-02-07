import { describe, expect, it } from 'vitest';

import { GET, POST } from './route';

describe('NextAuth route', () => {
  it('returns not_configured when required env vars are missing', async () => {
    const originalEnv = {
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    };

    delete process.env.NEXTAUTH_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    try {
      const getResponse = await GET(new Request('http://localhost/api/auth'));
      const postResponse = await POST(new Request('http://localhost/api/auth'));

      expect(getResponse.status).toBe(503);
      expect(await getResponse.json()).toEqual({ error: 'not_configured' });
      expect(postResponse.status).toBe(503);
      expect(await postResponse.json()).toEqual({ error: 'not_configured' });
    } finally {
      if (originalEnv.NEXTAUTH_SECRET === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = originalEnv.NEXTAUTH_SECRET;
      }
      if (originalEnv.GOOGLE_CLIENT_ID === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
      } else {
        process.env.GOOGLE_CLIENT_ID = originalEnv.GOOGLE_CLIENT_ID;
      }
      if (originalEnv.GOOGLE_CLIENT_SECRET === undefined) {
        delete process.env.GOOGLE_CLIENT_SECRET;
      } else {
        process.env.GOOGLE_CLIENT_SECRET = originalEnv.GOOGLE_CLIENT_SECRET;
      }
    }
  });
});
