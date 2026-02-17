import { afterEach, describe, expect, it, vi } from 'vitest';

import { enableDemoTabs } from './featureFlags';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('enableDemoTabs', () => {
  it('returns false by default', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_TABS', undefined);
    expect(enableDemoTabs()).toBe(false);
  });

  it('returns true only when env is string true', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_TABS', 'true');
    expect(enableDemoTabs()).toBe(true);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_TABS', 'false');
    expect(enableDemoTabs()).toBe(false);
  });
});
