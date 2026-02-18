import { describe, expect, it, vi } from 'vitest';

import { ArtifactIndexSchema, type SummaryArtifact } from '@timeline/shared';

import { artifactToIndexEntry, upsertArtifactIndex, upsertArtifactIndexEntry } from './artifactIndex';

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

  it('re-loads and merges on write conflict so no entries are dropped', async () => {
    const state = {
      index: ArtifactIndexSchema.parse({
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        artifacts: [{ id: 'a1', driveFileId: 'file-a1', title: 'A1' }],
      }),
      updateCalls: 0,
    };

    const drive = {
      files: {
        list: vi.fn().mockResolvedValue({ data: { files: [{ id: 'idx-1' }] } }),
        get: vi.fn().mockImplementation(() => Promise.resolve({ data: state.index })),
        update: vi.fn().mockImplementation((request: { media?: { body?: string } }) => {
          state.updateCalls += 1;
          const nextPayload = JSON.parse(request.media?.body ?? '{}') as typeof state.index;
          if (state.updateCalls === 1) {
            // Simulate another writer winning first: index now has a2.
            state.index = ArtifactIndexSchema.parse({
              ...state.index,
              artifacts: [...state.index.artifacts, { id: 'a2', driveFileId: 'file-a2', title: 'A2' }],
            });
            const conflict = new Error('etag mismatch');
            (conflict as Error & { status?: number }).status = 412;
            return Promise.reject(conflict);
          }

          state.index = ArtifactIndexSchema.parse(nextPayload);
          return Promise.resolve({ data: { id: 'idx-1' } });
        }),
      },
    };

    await upsertArtifactIndex(
      drive as never,
      'folder-1',
      artifact({ artifactId: 'a3', driveFileId: 'file-a3', title: 'A3' }),
    );

    expect(state.index.artifacts.map((item) => item.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(state.updateCalls).toBe(2);
  });

  it('counts only open openLoops in index entry rollup', () => {
    const entry = artifactToIndexEntry(
      artifact({
        openLoops: [
          { text: 'Open item', status: 'open' },
          { text: 'Closed item', status: 'closed', closedAtISO: '2026-01-01T00:00:00Z' },
        ],
      }),
    );

    expect(entry.openLoopsCount).toBe(1);
  });

});
