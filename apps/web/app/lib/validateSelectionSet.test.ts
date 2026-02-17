import { describe, expect, it } from 'vitest';

import { isSelectionSet, normalizeSelectionSet } from './validateSelectionSet';

const baseSet = {
  id: 'set-1',
  name: 'Quarterly Planning',
  createdAtISO: '2024-03-01T00:00:00Z',
  updatedAtISO: '2024-03-02T00:00:00Z',
  items: [
    { source: 'gmail', id: 'msg-1', title: 'Hello', dateISO: '2024-03-01T00:00:00Z' },
    { source: 'drive', id: 'file-1' },
  ],
  notes: 'Important inbox',
  version: 1,
  driveFolderId: 'folder-1',
  driveFileId: 'file-99',
  driveWebViewLink: 'https://drive.google.com/file',
};

describe('validateSelectionSet', () => {
  it('accepts a valid selection set payload', () => {
    expect(isSelectionSet(baseSet)).toBe(true);
  });

  it('rejects invalid selection sets', () => {
    expect(isSelectionSet({})).toBe(false);
    expect(
      isSelectionSet({
        ...baseSet,
        items: [{ source: 'calendar', id: 'nope' }],
      }),
    ).toBe(false);
  });

  it('normalizes selection sets', () => {
    const normalized = normalizeSelectionSet({
      ...baseSet,
      name: '  ',
      notes: '  ',
      items: [
        { source: 'gmail', id: 'msg-2', title: '  Weekly update  ', dateISO: '  ' },
        { source: 'drive', id: 'file-2' },
      ],
      version: 0,
    });

    expect(normalized.name).toBe('Untitled Selection');
    expect(normalized.notes).toBeUndefined();
    expect(normalized.items[0].title).toBe('Weekly update');
    expect(normalized.items[0].dateISO).toBeUndefined();
    expect(normalized.version).toBe(1);
  });


  it('accepts unknown top-level fields in drive selection files', () => {
    expect(
      isSelectionSet({
        ...baseSet,
        futureField: { nested: true },
      }),
    ).toBe(true);
  });

  it('validates optional envelope fields when present', () => {
    expect(
      isSelectionSet({
        ...baseSet,
        type: 'selection_set',
        status: 'complete',
        meta: {
          driveFileId: 'file-99',
          extraContext: 'ok',
        },
      }),
    ).toBe(true);

    expect(
      isSelectionSet({
        ...baseSet,
        type: 123,
      }),
    ).toBe(false);
  });
  it('accepts sets missing optional fields', () => {
    const legacy = {
      ...baseSet,
      version: undefined,
      driveFolderId: undefined,
      driveFileId: undefined,
      driveWebViewLink: undefined,
    };

    expect(isSelectionSet(legacy)).toBe(true);
    const normalized = normalizeSelectionSet(legacy);
    expect(normalized.version).toBe(1);
  });
});
