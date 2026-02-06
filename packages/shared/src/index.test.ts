import { describe, expectTypeOf, it } from 'vitest';

import type { EchoResponse, HealthResponse } from './index';

describe('shared types', () => {
  it('exposes the expected response shapes', () => {
    expectTypeOf<HealthResponse>().toEqualTypeOf<{ ok: boolean }>();
    expectTypeOf<EchoResponse>().toEqualTypeOf<{ query: unknown; body: unknown }>();
  });
});
