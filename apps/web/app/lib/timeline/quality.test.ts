import { describe, expect, it } from 'vitest';

import type { TimelineArtifact } from './exportBuilder';
import { getUndatedArtifacts, summarizeDateCoverage } from './quality';

const artifact = (id: string, contentDateISO?: string): TimelineArtifact => ({
  entryKey: id,
  artifact: {
    artifactId: id,
    source: 'drive',
    sourceId: id,
    title: id,
    createdAtISO: '2026-01-01T00:00:00.000Z',
    summary: 'Summary',
    highlights: ['h'],
    driveFolderId: 'folder-1',
    driveFileId: id,
    model: 'stub',
    version: 1,
    ...(contentDateISO ? { contentDateISO } : {}),
  },
});

describe('timeline quality helpers', () => {
  it('returns undated artifacts only', () => {
    const undated = getUndatedArtifacts([
      artifact('dated', '2026-01-02T00:00:00.000Z'),
      artifact('undated-1'),
      artifact('undated-2'),
    ]);

    expect(undated.map((item) => item.artifact.artifactId)).toEqual(['undated-1', 'undated-2']);
  });

  it('summarizes coverage counts', () => {
    expect(
      summarizeDateCoverage([
        artifact('dated', '2026-01-02T00:00:00.000Z'),
        artifact('undated-1'),
      ]),
    ).toEqual({ total: 2, dated: 1, undated: 1 });
  });
});
