import { describe, expect, it } from 'vitest';

import { buildIndexFromDriveListing } from './buildIndex';

describe('buildIndexFromDriveListing', () => {
  it('parses summary and selection filenames', () => {
    const index = buildIndexFromDriveListing([
      {
        id: 'summary-1',
        name: 'Launch Plan - Summary.json',
        modifiedTime: '2024-03-02T00:00:00Z',
        webViewLink: 'https://drive.google.com/summary-1',
      },
      {
        id: 'selection-1',
        name: 'Q1 Goals - Selection.json',
        modifiedTime: '2024-03-03T00:00:00Z',
        webViewLink: 'https://drive.google.com/selection-1',
      },
    ]);

    expect(index.summaries).toHaveLength(1);
    expect(index.summaries[0].title).toBe('Launch Plan');
    expect(index.selectionSets).toHaveLength(1);
    expect(index.selectionSets[0].name).toBe('Q1 Goals');
  });

  it('orders entries by updatedAtISO desc', () => {
    const index = buildIndexFromDriveListing([
      {
        id: 'summary-older',
        name: 'Older - Summary.json',
        modifiedTime: '2024-03-01T00:00:00Z',
      },
      {
        id: 'summary-newer',
        name: 'Newer - Summary.json',
        modifiedTime: '2024-03-10T00:00:00Z',
      },
    ]);

    expect(index.summaries[0].driveFileId).toBe('summary-newer');
    expect(index.summaries[1].driveFileId).toBe('summary-older');
  });
});
