import { describe, expect, it } from 'vitest';

import {
  buildTimelineEntries,
  filterEntries,
  groupEntries,
  sortEntries,
  type TimelineEntry,
  type TimelineFilters,
} from './timelineView';

const buildEntry = (partial: Partial<TimelineEntry>): TimelineEntry => ({
  key: partial.key ?? 'gmail:1',
  source: partial.source ?? 'gmail',
  id: partial.id ?? '1',
  title: partial.title ?? 'Title',
  dateISO: partial.dateISO,
  status: partial.status ?? 'pending',
  kind: partial.kind ?? 'selection',
  tags: partial.tags ?? [],
  hasDriveLink: partial.hasDriveLink ?? false,
  driveWebViewLink: partial.driveWebViewLink,
  previewText: partial.previewText ?? '',
  summary: partial.summary,
  highlights: partial.highlights,
  sourcePreview: partial.sourcePreview,
  sourceMetadata: partial.sourceMetadata,
  metadata: partial.metadata,
});

describe('timelineView', () => {
  it('groups entries by day, week, and month', () => {
    const entries = [
      buildEntry({ key: 'gmail:1', dateISO: '2024-01-01T10:00:00Z' }),
      buildEntry({ key: 'gmail:2', dateISO: '2024-01-01T12:00:00Z' }),
      buildEntry({ key: 'drive:1', dateISO: '2024-02-10T09:00:00Z', source: 'drive' }),
    ];

    expect(groupEntries(entries, 'day')).toHaveLength(2);
    expect(groupEntries(entries, 'week')).toHaveLength(2);
    expect(groupEntries(entries, 'month')).toHaveLength(2);
  });

  it('filters entries by source, status, and text', () => {
    const entries = [
      buildEntry({
        key: 'gmail:1',
        source: 'gmail',
        status: 'summarized',
        kind: 'summary',
        title: 'Kickoff',
        previewText: 'Project kickoff details',
        tags: ['INBOX'],
      }),
      buildEntry({
        key: 'drive:1',
        source: 'drive',
        status: 'pending',
        kind: 'selection',
        title: 'Specs',
        previewText: 'Draft spec document',
        tags: ['application/pdf'],
      }),
    ];

    const filters: TimelineFilters = {
      source: 'gmail',
      status: 'summarized',
      kind: 'summary',
      tag: 'all',
      text: 'kickoff',
    };

    const filtered = filterEntries(entries, filters);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe('gmail:1');
  });

  it('sorts entries by date while keeping stable order for ties', () => {
    const entries = [
      buildEntry({ key: 'a', dateISO: '2024-01-02T00:00:00Z' }),
      buildEntry({ key: 'b', dateISO: '2024-01-01T00:00:00Z' }),
      buildEntry({ key: 'c', dateISO: '2024-01-01T00:00:00Z' }),
    ];

    const sorted = sortEntries(entries);
    expect(sorted.map((entry) => entry.key)).toEqual(['a', 'b', 'c']);
  });

  it('builds entries from selections and artifacts', () => {
    const entries = buildTimelineEntries(
      [
        {
          source: 'gmail',
          id: 'msg-1',
          title: 'Hello',
          dateISO: '2024-01-01T00:00:00Z',
          metadata: { from: 'alice@example.com', subject: 'Hello' },
        },
      ],
      {
        'gmail:msg-1': {
          artifactId: 'gmail:msg-1',
          source: 'gmail',
          sourceId: 'msg-1',
          title: 'Hello',
          createdAtISO: '2024-01-02T00:00:00Z',
          summary: 'Summary text',
          highlights: [],
          driveFolderId: 'folder',
          driveFileId: 'file',
          model: 'stub',
          version: 1,
        },
      },
      null,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('summarized');
    expect(entries[0].previewText).toContain('Summary');
  });
});
