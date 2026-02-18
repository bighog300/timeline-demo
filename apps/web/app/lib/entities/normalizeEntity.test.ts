import { describe, expect, it } from 'vitest';

import { normalizeEntityName } from './normalizeEntity';

describe('normalizeEntityName', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeEntityName('  ACME   LTD  ')).toBe('acme');
  });

  it('strips common suffixes and punctuation', () => {
    expect(normalizeEntityName('Acme Corporation,')).toBe('acme');
    expect(normalizeEntityName('Example GmbH.')).toBe('example');
  });
});
