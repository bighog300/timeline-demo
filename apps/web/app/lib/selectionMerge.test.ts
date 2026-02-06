import { describe, expect, it } from 'vitest';

import { mergeSelectionItems, selectionItemKey } from './selectionMerge';

describe('mergeSelectionItems', () => {
  it('deduplicates by source and id', () => {
    const existing = [
      { source: 'gmail', id: 'msg-1', title: 'Hello' },
      { source: 'drive', id: 'file-1', title: 'Doc' },
    ];
    const incoming = [
      { source: 'gmail', id: 'msg-1', title: 'Hello again' },
      { source: 'drive', id: 'file-2', title: 'Spreadsheet' },
    ];

    const merged = mergeSelectionItems(existing, incoming);

    expect(merged.map(selectionItemKey)).toEqual(['gmail:msg-1', 'drive:file-1', 'drive:file-2']);
  });

  it('prefers existing metadata but fills missing fields from incoming', () => {
    const existing = [{ source: 'gmail', id: 'msg-1', title: '', dateISO: '' }];
    const incoming = [{ source: 'gmail', id: 'msg-1', title: 'Subject', dateISO: '2024-01-01' }];

    const merged = mergeSelectionItems(existing, incoming);

    expect(merged).toEqual([
      { source: 'gmail', id: 'msg-1', title: 'Subject', dateISO: '2024-01-01' },
    ]);
  });
});
