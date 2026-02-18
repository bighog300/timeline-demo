import { describe, expect, it } from 'vitest';

import type { SummaryArtifact } from './types';
import { artifactDayKey, groupArtifactsByDay } from './groupArtifactsByDay';

const baseArtifact: SummaryArtifact = {
  artifactId: 'artifact-1',
  source: 'drive',
  sourceId: 'source-1',
  title: 'Artifact',
  createdAtISO: '2024-05-02T12:00:00.000Z',
  summary: 'Summary',
  highlights: [],
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  model: 'stub',
  version: 1,
};

describe('groupArtifactsByDay', () => {
  it('prefers contentDateISO over sourceMetadata.dateISO and createdAtISO', () => {
    const artifact = {
      ...baseArtifact,
      contentDateISO: '2024-03-20T10:00:00.000Z',
      sourceMetadata: { dateISO: '2024-04-01T09:30:00.000Z' },
    };

    expect(artifactDayKey(artifact)).toBe('2024-03-20');
    expect(Object.keys(groupArtifactsByDay([artifact]))).toEqual(['2024-03-20']);
  });

  it('falls back to sourceMetadata.dateISO when contentDateISO is missing', () => {
    const grouped = groupArtifactsByDay([
      {
        ...baseArtifact,
        sourceMetadata: { dateISO: '2024-04-01T09:30:00.000Z' },
      },
    ]);

    expect(Object.keys(grouped)).toEqual(['2024-04-01']);
  });

  it('falls back to createdAtISO when contentDateISO and sourceMetadata.dateISO are missing', () => {
    const grouped = groupArtifactsByDay([
      {
        ...baseArtifact,
        sourceMetadata: { subject: 'No date in metadata' },
      },
    ]);

    expect(Object.keys(grouped)).toEqual(['2024-05-02']);
  });
});
