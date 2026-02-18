import { describe, expect, it } from 'vitest';

import { ArtifactIndexSchema, type SummaryArtifact } from '@timeline/shared';

import { artifactToIndexEntry, upsertArtifactIndexEntry } from './artifactIndex';

const artifact = (overrides: Partial<SummaryArtifact> = {}): SummaryArtifact => ({
  artifactId: 'gmail:1',
  source: 'gmail',
  sourceId: '1',
  title: 'Subject',
  createdAtISO: '2026-01-01T10:00:00Z',
  summary: 'Summary',
  highlights: ['h1'],
  sourceMetadata: { from: 'a@example.com', to: 'b@example.com', labels: ['inbox'] },
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  model: 'stub',
  version: 1,
  ...overrides,
});

describe('artifactIndex helpers', () => {
  it('upserts by id and dedupes', () => {
    const initial = ArtifactIndexSchema.parse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      artifacts: [{ id: 'gmail:1', driveFileId: 'old', title: 'Old' }],
    });

    const next = upsertArtifactIndexEntry(initial, artifactToIndexEntry(artifact()));

    expect(next.artifacts).toHaveLength(1);
    expect(next.artifacts[0].driveFileId).toBe('file-1');
  });

  it('produces schema-valid index entries', () => {
    const entry = artifactToIndexEntry(artifact({ sourceMetadata: { labels: ['x', 'x', 'y'] } }));
    const parsed = ArtifactIndexSchema.shape.artifacts.element.safeParse(entry);

    expect(parsed.success).toBe(true);
    expect(entry.tags).toEqual(['x', 'y']);
  });
});
