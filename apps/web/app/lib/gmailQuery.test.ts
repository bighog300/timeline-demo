import { describe, expect, it } from 'vitest';

import { buildGmailQuery, parseSender } from './gmailQuery';

describe('buildGmailQuery', () => {
  it('builds grouped sender query with default filters', () => {
    const query = buildGmailQuery({
      senders: ['Alice@Example.com', 'bob@example.com', 'alice@example.com'],
      daysBack: '30',
      hasAttachment: true,
      freeText: '  quarterly   report ',
    });

    expect(query).toBe(
      'from:(alice@example.com OR bob@example.com) newer_than:30d has:attachment quarterly report',
    );
  });

  it('uses after for custom date when valid', () => {
    const query = buildGmailQuery({
      senders: ['carol@example.com'],
      daysBack: 'custom',
      customAfter: '2024-11-09T12:00:00Z',
      hasAttachment: false,
      freeText: '',
    });

    expect(query).toBe('from:carol@example.com after:2024/11/09');
  });

  it('omits custom date when invalid and escapes quoted free text', () => {
    const query = buildGmailQuery({
      senders: [],
      daysBack: 'custom',
      customAfter: 'not-a-date',
      hasAttachment: false,
      freeText: 'status "critical"',
    });

    expect(query).toBe('"status \\"critical\\""');
  });
});

describe('parseSender', () => {
  it('parses sender with display name', () => {
    expect(parseSender('Alice Example <Alice@Example.com>')).toEqual({
      name: 'Alice Example',
      email: 'alice@example.com',
    });
  });

  it('returns null for malformed headers', () => {
    expect(parseSender('unknown sender')).toBeNull();
  });
});
