import { afterEach, describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/meta/build', () => {
  const originalEnv = {
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    GITHUB_SHA: process.env.GITHUB_SHA,
    COMMIT_SHA: process.env.COMMIT_SHA,
    BUILD_TIME_ISO: process.env.BUILD_TIME_ISO,
  };

  afterEach(() => {
    process.env.VERCEL_GIT_COMMIT_SHA = originalEnv.VERCEL_GIT_COMMIT_SHA;
    process.env.GITHUB_SHA = originalEnv.GITHUB_SHA;
    process.env.COMMIT_SHA = originalEnv.COMMIT_SHA;
    process.env.BUILD_TIME_ISO = originalEnv.BUILD_TIME_ISO;
  });

  it('returns build metadata with no-store caching', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
    process.env.BUILD_TIME_ISO = '2025-01-01T00:00:00.000Z';

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const payload = (await response.json()) as { gitSha: string; buildTimeISO: string };

    expect(payload.gitSha).toEqual(expect.any(String));
    expect(payload.buildTimeISO).toEqual(expect.any(String));
  });
});
