import { describe, expect, it } from 'vitest';

import type { CalendarEntry } from './types';
import { isCalendarEntry, normalizeCalendarEntry } from './validateCalendarEntry';

const baseEntry: CalendarEntry = {
  type: 'calendar_entry',
  id: 'cal-1',
  title: 'Strategy review',
  startISO: '2024-03-01T09:00:00Z',
  endISO: '2024-03-01T10:00:00Z',
  allDay: false,
  location: 'Room 3B',
  notes: 'Bring the roadmap.',
  tags: ['planning', 'q1'],
  links: [{ kind: 'summary', id: 'file-1', url: 'https://drive.google.com/file-1' }],
  source: 'user',
  createdAtISO: '2024-02-25T10:00:00Z',
  updatedAtISO: '2024-02-26T10:00:00Z',
};

describe('isCalendarEntry', () => {
  it('accepts valid calendar entry data', () => {
    expect(isCalendarEntry(baseEntry)).toBe(true);
  });

  it('rejects invalid calendar entry data', () => {
    const invalid = { ...baseEntry, type: 'summary' } as unknown as CalendarEntry;
    expect(isCalendarEntry(invalid)).toBe(false);
  });
});

describe('normalizeCalendarEntry', () => {
  it('filters invalid tags and links', () => {
    const normalized = normalizeCalendarEntry({
      ...baseEntry,
      tags: ['valid', 123 as never],
      links: [{ kind: 'drive_file', id: 'file-2' }, { kind: 'nope', id: 'file-3' }] as never,
    });

    expect(normalized.tags).toEqual(['valid']);
    expect(normalized.links).toEqual([{ kind: 'drive_file', id: 'file-2' }]);
  });
});
