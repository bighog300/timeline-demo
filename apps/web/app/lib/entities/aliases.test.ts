import { describe, expect, it } from 'vitest';

import { canonicalizeEntities, normalizeEntityAliases } from './aliases';

describe('entity aliases', () => {
  it('maps alias acme ltd to canonical acme', () => {
    const aliases = normalizeEntityAliases({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      aliases: [{ alias: 'acme ltd uk', canonical: 'acme', displayName: 'Acme' }],
    });

    expect(aliases?.aliases[0].alias).toBe('acme ltd uk');
    const result = canonicalizeEntities([{ name: 'ACME LTD UK', type: 'org' }], aliases!);
    expect(result).toEqual([{ name: 'Acme', type: 'org' }]);
  });
});
