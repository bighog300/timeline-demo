import { describe, expect, it } from 'vitest';

import type { TimelineArtifact } from './exportBuilder';
import { computeMissingInfo } from './missingInfo';

const makeArtifact = (overrides: Partial<TimelineArtifact['artifact']>): TimelineArtifact => ({
  entryKey: overrides.artifactId ?? 'e1',
  artifact: {
    artifactId: overrides.artifactId ?? 'a1',
    source: 'drive',
    sourceId: 'src',
    title: 'Invoice',
    createdAtISO: '2026-01-01T00:00:00.000Z',
    summary: 'Invoice generated',
    highlights: [],
    driveFolderId: 'f',
    driveFileId: overrides.driveFileId ?? 'd1',
    model: 'stub',
    version: 1,
    ...overrides,
  },
});

describe('computeMissingInfo', () => {
  it('detects missing entities/location/amount/date', () => {
    const result = computeMissingInfo([makeArtifact({})]);
    expect(result.missingEntitiesIds).toEqual(['d1']);
    expect(result.missingLocationIds).toEqual(['d1']);
    expect(result.missingAmountIds).toEqual(['d1']);
    expect(result.missingDateIds).toEqual(['d1']);
  });

  it('respects user annotations as fixed', () => {
    const result = computeMissingInfo([makeArtifact({
      contentDateISO: '2026-02-01T00:00:00.000Z',
      userAnnotations: { entities: ['Alice'], location: 'London', amount: '£99' },
    })]);
    expect(result.missingEntitiesIds).toEqual([]);
    expect(result.missingLocationIds).toEqual([]);
    expect(result.missingAmountIds).toEqual([]);
    expect(result.missingDateIds).toEqual([]);
  });
});
