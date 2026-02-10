import { describe, expect, it, vi } from 'vitest';

import { fileTypeBadge, formatBytes, formatRelativeTime } from './formatters';

describe('drive formatters', () => {
  it('formats bytes to human readable units', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('maps mime types to badges', () => {
    expect(fileTypeBadge('application/pdf')).toEqual({ label: 'PDF', kind: 'pdf' });
    expect(fileTypeBadge('application/vnd.google-apps.spreadsheet')).toEqual({ label: 'Sheet', kind: 'sheet' });
    expect(fileTypeBadge('image/png')).toEqual({ label: 'Image', kind: 'image' });
    expect(fileTypeBadge('text/plain')).toEqual({ label: 'Other', kind: 'other' });
  });

  it('formats relative time in days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-02-10T00:00:00.000Z'));

    expect(formatRelativeTime('2025-02-07T00:00:00.000Z')).toBe('3 days ago');
    expect(formatRelativeTime(null)).toBe('—');

    vi.useRealTimers();
  });
});
