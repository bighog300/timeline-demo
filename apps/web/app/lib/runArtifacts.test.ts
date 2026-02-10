import { describe, expect, it } from 'vitest';

import { buildRunArtifact, isSelectionSetRunArtifact } from './runArtifacts';

describe('runArtifacts', () => {
  it('buildRunArtifact initializes metadata-only payload', () => {
    const run = buildRunArtifact({
      id: 'run-1',
      selectionSet: {
        kind: 'gmail_selection_set',
        version: 1,
        id: 'set-1',
        title: 'Inbox invoices',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        source: 'gmail',
        query: {
          q: 'from:billing@example.com',
          senders: ['billing@example.com'],
          datePreset: '30d',
          customAfter: null,
          hasAttachment: false,
          freeText: 'invoice',
        },
      },
      action: 'summarize',
      startedAt: '2025-01-01T12:00:00.000Z',
      caps: {
        maxPages: 5,
        maxItems: 50,
        pageSize: 50,
        batchSize: 10,
      },
    });

    expect(run.id).toBe('run-1');
    expect(run.selectionSet.query).toEqual({ q: 'from:billing@example.com' });
    expect(run.items).toEqual({ ids: null, idsIncluded: false });
    expect(run.result.status).toBe('failed');
    expect(isSelectionSetRunArtifact(run)).toBe(true);
  });
});
