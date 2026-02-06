import { describe, expect, it } from 'vitest';

import { summarizeDeterministic } from './summarize';

describe('summarizeDeterministic', () => {
  it('produces stable summaries and highlights', () => {
    const input = {
      title: 'Weekly update',
      text: 'First sentence. Second sentence! Third sentence? Fourth sentence.\nHighlight one\nHighlight two',
    };

    const result = summarizeDeterministic(input);

    expect(result.summary).toMatch(/First sentence\. Second sentence! Third sentence\?/);
    expect(result.highlights[0]).toBe('First sentence. Second sentence! Third sentence? Fourth sentence.');
    expect(result.highlights).toContain('Highlight one');
  });
});
