import { describe, expect, it } from 'vitest';

import type { TimelineIndex } from './indexTypes';
import { isIndexFresh } from './indexFreshness';

const baseIndex: TimelineIndex = {
  version: 1,
  updatedAtISO: '2024-04-01T12:00:00Z',
  driveFolderId: 'folder-1',
  indexFileId: 'index-1',
  summaries: [],
  selectionSets: [],
};

describe('isIndexFresh', () => {
  it('returns true when updated recently', () => {
    const now = new Date('2024-04-01T12:05:00Z');
    expect(isIndexFresh(baseIndex, now, 10)).toBe(true);
  });

  it('returns false when stale', () => {
    const now = new Date('2024-04-01T12:30:00Z');
    expect(isIndexFresh(baseIndex, now, 10)).toBe(false);
  });
});
