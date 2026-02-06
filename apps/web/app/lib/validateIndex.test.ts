import { describe, expect, it } from 'vitest';

import type { TimelineIndex } from './indexTypes';
import { isTimelineIndex, normalizeTimelineIndex } from './validateIndex';

const baseIndex: TimelineIndex = {
  version: 1,
  updatedAtISO: '2024-04-01T00:00:00Z',
  driveFolderId: 'folder-1',
  indexFileId: 'index-1',
  summaries: [
    {
      driveFileId: 'summary-1',
      title: 'Q1 Update',
      source: 'gmail',
      sourceId: 'msg-1',
      updatedAtISO: '2024-04-01T00:00:00Z',
    },
  ],
  selectionSets: [
    {
      driveFileId: 'selection-1',
      name: 'Leadership',
      updatedAtISO: '2024-04-02T00:00:00Z',
    },
  ],
  stats: { totalSummaries: 1, totalSelectionSets: 1 },
};

describe('validateIndex', () => {
  it('accepts valid index payloads', () => {
    expect(isTimelineIndex(baseIndex)).toBe(true);
  });

  it('rejects invalid entries', () => {
    expect(
      isTimelineIndex({
        ...baseIndex,
        summaries: [{ driveFileId: '', title: 'Bad', source: 'gmail', sourceId: 'msg' }],
      }),
    ).toBe(false);
  });

  it('normalizes missing optional fields', () => {
    const legacy = {
      summaries: [
        {
          driveFileId: 'summary-2',
          title: '  ',
          sourceId: 'summary-2',
        },
      ],
      selectionSets: [{ driveFileId: 'selection-2', name: '  ' }],
    } as TimelineIndex;

    expect(isTimelineIndex(legacy)).toBe(true);
    const normalized = normalizeTimelineIndex(legacy, 'folder-2', 'index-2');

    expect(normalized.driveFolderId).toBe('folder-2');
    expect(normalized.indexFileId).toBe('index-2');
    expect(normalized.summaries[0].title).toBe('Untitled Summary');
    expect(normalized.summaries[0].source).toBe('drive');
    expect(normalized.selectionSets[0].name).toBe('Untitled Selection');
    expect(normalized.stats?.totalSummaries).toBe(1);
  });
});
