import { describe, expect, it } from 'vitest';

import type { TimelineArtifact } from './exportBuilder';
import { extractEntityStrings, filterArtifactsByEntity } from './entities';

const makeArtifact = (overrides: Partial<TimelineArtifact['artifact']>): TimelineArtifact => ({
  entryKey: overrides.artifactId ?? 'entry-1',
  artifact: {
    artifactId: 'artifact-1',
    source: 'gmail',
    sourceId: 'msg-1',
    title: 'Update',
    createdAtISO: '2024-01-01T00:00:00.000Z',
    summary: 'General update',
    highlights: [],
    driveFolderId: 'folder-1',
    driveFileId: 'drive-1',
    model: 'stub',
    version: 1,
    ...overrides,
  },
});

describe('entities helpers', () => {
  it('extractEntityStrings uses structured entities when present', () => {
    const artifact = makeArtifact({ entities: [{ name: '  Alice  ' }, { name: 'Acme Corp' }] });
    expect(extractEntityStrings(artifact)).toEqual(['Alice', 'Acme Corp']);
  });

  it('includes user annotations entities in extraction', () => {
    const artifact = makeArtifact({ userAnnotations: { entities: ['  Alice  '] } });
    expect(extractEntityStrings(artifact)).toEqual(['Alice']);
  });

  it('filterArtifactsByEntity matches structured exact match (case-insensitive)', () => {
    const artifacts = [
      makeArtifact({ artifactId: 'a-1', entities: [{ name: 'Alice Johnson' }] }),
      makeArtifact({ artifactId: 'a-2', entities: [{ name: 'Bob Stone' }] }),
    ];

    const result = filterArtifactsByEntity(artifacts, 'alice johnson');
    expect(result.map((item) => item.artifact.artifactId)).toEqual(['a-1']);
  });

  it('falls back to text matching with word boundaries for short entities', () => {
    const artifacts = [
      makeArtifact({ artifactId: 'a-1', summary: 'FYI: ETA is now Friday.' }),
      makeArtifact({ artifactId: 'a-2', summary: 'Metadata only.' }),
    ];

    const result = filterArtifactsByEntity(artifacts, 'ETA');
    expect(result.map((item) => item.artifact.artifactId)).toEqual(['a-1']);
  });

  it('avoids false positives for short strings', () => {
    const artifacts = [
      makeArtifact({ artifactId: 'a-1', summary: 'We are cataloging updates.' }),
      makeArtifact({ artifactId: 'a-2', summary: 'The cat arrived at noon.' }),
    ];

    const result = filterArtifactsByEntity(artifacts, 'cat');
    expect(result.map((item) => item.artifact.artifactId)).toEqual(['a-2']);
  });
});
