import { describe, expect, it } from 'vitest';

import type { SummaryArtifact } from './types';
import { mergeArtifacts } from './artifactMerge';

const makeArtifact = (sourceId: string, createdAtISO: string): SummaryArtifact => ({
  artifactId: `gmail:${sourceId}`,
  source: 'gmail',
  sourceId,
  title: `Title ${sourceId}`,
  createdAtISO,
  summary: 'Summary',
  highlights: [],
  driveFolderId: 'folder',
  driveFileId: '',
  driveWebViewLink: undefined,
  model: 'stub',
  version: 1,
});

describe('mergeArtifacts', () => {
  it('merges updates into the map and prefers latest entries', () => {
    const existing = {
      'gmail:a': makeArtifact('a', '2024-01-01T00:00:00Z'),
    };

    const updates = [makeArtifact('b', '2024-02-01T00:00:00Z')];

    const result = mergeArtifacts(existing, updates, 100);

    expect(result['gmail:a']).toBeDefined();
    expect(result['gmail:b']).toBeDefined();
  });

  it('caps results to the newest artifacts', () => {
    const existing = {
      'gmail:a': makeArtifact('a', '2024-01-01T00:00:00Z'),
      'gmail:b': makeArtifact('b', '2024-02-01T00:00:00Z'),
    };

    const updates = [makeArtifact('c', '2024-03-01T00:00:00Z')];

    const result = mergeArtifacts(existing, updates, 2);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['gmail:c']).toBeDefined();
    expect(result['gmail:b']).toBeDefined();
  });
});
