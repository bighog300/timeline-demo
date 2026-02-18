import { describe, expect, it } from 'vitest';

import { DELETE as LegacyDelete, GET as LegacyGet, PATCH as LegacyPatch } from './route';
import { DELETE as SavedDelete, GET as SavedGet, PATCH as SavedPatch } from '../../saved-searches/[id]/route';

describe('/api/selection-sets/[id] shim', () => {
  it('re-exports handlers from /api/saved-searches/[id]', () => {
    expect(LegacyGet).toBe(SavedGet);
    expect(LegacyPatch).toBe(SavedPatch);
    expect(LegacyDelete).toBe(SavedDelete);
  });
});
