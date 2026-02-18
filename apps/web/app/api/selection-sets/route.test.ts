import { describe, expect, it } from 'vitest';

import { GET as LegacyGet, POST as LegacyPost } from './route';
import { GET as SavedGet, POST as SavedPost } from '../saved-searches/route';

describe('/api/selection-sets shim', () => {
  it('re-exports handlers from /api/saved-searches', () => {
    expect(LegacyGet).toBe(SavedGet);
    expect(LegacyPost).toBe(SavedPost);
  });
});
