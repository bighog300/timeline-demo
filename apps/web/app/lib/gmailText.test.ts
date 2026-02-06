import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities, normalizeWhitespace, stripHtml, trimQuotedReplies } from './gmailText';

describe('gmailText helpers', () => {
  it('decodes common HTML entities', () => {
    const input = 'Hello&nbsp;world &amp; friends &#39;ok&#39;';
    expect(decodeHtmlEntities(input)).toBe("Hello world & friends 'ok'");
  });

  it('strips HTML tags and preserves readable text', () => {
    const input = '<div>Hello<br/>world</div><p>Line&nbsp;two</p>';
    expect(stripHtml(input)).toContain('Hello');
    expect(stripHtml(input)).toContain('world');
    expect(stripHtml(input)).toContain('Line two');
  });

  it('trims quoted replies conservatively', () => {
    const input = [
      'Quick update on the project.',
      '',
      'On Jan 1, 2024, Bob wrote:',
      '> quoted text',
      '> another line',
    ].join('\n');

    expect(trimQuotedReplies(input)).toBe('Quick update on the project.');
  });

  it('normalizes whitespace and removes extra blank lines', () => {
    const input = 'Hello   there\r\n\r\n\r\nHow\tare   you?';
    expect(normalizeWhitespace(input)).toBe('Hello there\n\nHow are you?');
  });
});
