import { describe, expect, it } from 'vitest';

import { hydrateGmailQueryControls } from './selectionSetHydration';

describe('hydrateGmailQueryControls', () => {
  it('maps persisted query to Gmail UI controls', () => {
    const result = hydrateGmailQueryControls({
      kind: 'gmail_selection_set',
      version: 1,
      id: 'set-1',
      title: 'Invoices',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      source: 'gmail',
      query: {
        q: 'from:example newer_than:30d',
        senders: ['billing@example.com'],
        datePreset: 'custom',
        customAfter: '2024-01-15T12:00:00.000Z',
        hasAttachment: true,
        freeText: 'invoice',
      },
    });

    expect(result).toEqual({
      selectedSenders: ['billing@example.com'],
      daysBack: 'custom',
      customAfter: '2024-01-15',
      hasAttachment: true,
      freeText: 'invoice',
    });
  });
});
