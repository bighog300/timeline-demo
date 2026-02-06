import { describe, expect, it } from 'vitest';

import { buildUnsupportedPlaceholder, truncateText } from './driveText';

describe('driveText helpers', () => {
  it('truncates long text and appends marker', () => {
    const input = 'abcdefghijklmnopqrstuvwxyz';
    const result = truncateText(input, 25);
    expect(result).toBe('abcdefghijkl\n\n(truncated)');
  });

  it('builds a placeholder for unsupported types', () => {
    const placeholder = buildUnsupportedPlaceholder({
      name: 'Budget.pdf',
      mimeType: 'application/pdf',
      webViewLink: 'https://drive.google.com/file/d/123',
    });

    expect(placeholder).toContain('Unsupported for text extraction in Phase 3A.');
    expect(placeholder).toContain('Budget.pdf');
    expect(placeholder).toContain('application/pdf');
    expect(placeholder).toContain('https://drive.google.com/file/d/123');
  });
});
