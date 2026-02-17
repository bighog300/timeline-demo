import { describe, expect, it } from 'vitest';

import {
  SelectionSetSchema,
  SourceType,
  SummaryArtifactSchema,
} from './index.js';

describe('shared schemas', () => {
  it('exposes timeline zod schemas', () => {
    expect(SourceType.options).toEqual(['gmail', 'drive']);
    expect(SummaryArtifactSchema.shape.title).toBeDefined();
  });

  it('rejects invalid ISO strings for summary artifact timestamps', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: 'not-a-date',
      summary: 'Summary text',
      highlights: ['One'],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid ISO strings for selection set timestamps', () => {
    const result = SelectionSetSchema.safeParse({
      id: 'selection-1',
      name: 'Selection Name',
      createdAtISO: '2026-01-01T11:22:33Z',
      updatedAtISO: '2026-01-01T12:34:56Z',
      items: [],
      version: 1,
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
    });

    expect(result.success).toBe(true);
  });
});
