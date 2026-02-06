import { describe, expect, it } from 'vitest';

import type { SummaryArtifact } from './types';
import { isSummaryArtifact, normalizeArtifact } from './validateArtifact';

const baseArtifact: SummaryArtifact = {
  artifactId: 'gmail:abc',
  source: 'gmail',
  sourceId: 'abc',
  title: 'Hello',
  createdAtISO: '2024-01-01T00:00:00Z',
  summary: 'Summary text',
  highlights: ['One'],
  sourceMetadata: {
    from: 'alice@example.com',
    subject: 'Hello',
    labels: ['INBOX'],
  },
  sourcePreview: 'Preview text',
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  driveWebViewLink: 'https://drive.google.com/file',
  model: 'stub',
  version: 1,
};

describe('validateArtifact', () => {
  it('accepts valid SummaryArtifact data', () => {
    expect(isSummaryArtifact(baseArtifact)).toBe(true);
  });

  it('rejects invalid SummaryArtifact data', () => {
    const invalid = { ...baseArtifact, sourceId: 123 };
    expect(isSummaryArtifact(invalid)).toBe(false);
  });

  it('normalizes default values', () => {
    const normalized = normalizeArtifact({
      ...baseArtifact,
      highlights: ['One', 2 as unknown as string],
      model: '',
      version: 0,
      sourceMetadata: { from: 'alice@example.com', labels: ['INBOX', 123 as unknown as string] },
      sourcePreview: 123 as unknown as string,
    });

    expect(normalized.highlights).toEqual(['One']);
    expect(normalized.model).toBe('unknown');
    expect(normalized.version).toBe(1);
    expect(normalized.sourceMetadata?.labels).toEqual(['INBOX']);
    expect(normalized.sourcePreview).toBeUndefined();
  });
});
