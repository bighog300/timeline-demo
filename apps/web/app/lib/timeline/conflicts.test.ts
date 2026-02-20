import { describe, expect, it } from 'vitest';

import type { TimelineArtifact } from './exportBuilder';
import { detectPotentialConflicts } from './conflicts';

const artifact = (overrides: Partial<TimelineArtifact['artifact']> & { artifactId: string }): TimelineArtifact => ({
  entryKey: overrides.artifactId,
  artifact: {
    artifactId: overrides.artifactId,
    source: 'drive',
    sourceId: overrides.artifactId,
    title: 'Invoice meeting follow up',
    createdAtISO: '2026-01-01T00:00:00.000Z',
    contentDateISO: '2026-01-05T00:00:00.000Z',
    summary: 'Invoice meeting follow up happened and payment was paid for $1200.',
    highlights: ['h'],
    driveFolderId: 'folder',
    driveFileId: overrides.artifactId,
    model: 'stub',
    version: 1,
    ...overrides,
  },
});

describe('detectPotentialConflicts', () => {
  it('detects date conflict for similar labels and different dates', () => {
    const results = detectPotentialConflicts([
      artifact({ artifactId: 'a1', contentDateISO: '2026-01-05T00:00:00.000Z' }),
      artifact({ artifactId: 'a2', contentDateISO: '2026-01-12T00:00:00.000Z' }),
    ]);

    expect(results.some((conflict) => conflict.type === 'date')).toBe(true);
  });

  it('detects amount conflict for similar labels with different values', () => {
    const results = detectPotentialConflicts([
      artifact({ artifactId: 'a1', summary: 'Invoice meeting follow up reported a payment of $1200.' }),
      artifact({ artifactId: 'a2', summary: 'Invoice meeting follow up reported a payment of $1800.' }),
    ]);

    const amountConflict = results.find((conflict) => conflict.type === 'amount');
    expect(amountConflict).toBeDefined();
    expect(amountConflict?.details.leftValue).not.toEqual(amountConflict?.details.rightValue);
  });

  it('detects status conflict using antonym map', () => {
    const results = detectPotentialConflicts([
      artifact({ artifactId: 'a1', summary: 'Invoice meeting follow up confirms document was signed.' }),
      artifact({ artifactId: 'a2', summary: 'Invoice meeting follow up says document was not signed.' }),
    ]);

    expect(results.some((conflict) => conflict.type === 'status_fact')).toBe(true);
  });

  it('does not flag when dates match or label similarity is low', () => {
    const results = detectPotentialConflicts([
      artifact({ artifactId: 'a1', contentDateISO: '2026-01-05T00:00:00.000Z', title: 'Invoice meeting follow up' }),
      artifact({ artifactId: 'a2', contentDateISO: '2026-01-05T00:00:00.000Z', title: 'Completely different gardening notes', summary: 'Unrelated notes with no overlap.' }),
    ]);

    expect(results).toEqual([]);
  });

  it('caps output at 20 conflicts', () => {
    const artifacts = Array.from({ length: 8 }).map((_, index) =>
      artifact({
        artifactId: `a-${index}`,
        contentDateISO: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        summary: `Invoice meeting follow up says amount was $${1000 + index * 100} and was ${index % 2 === 0 ? 'signed' : 'not signed'}.`,
      }),
    );

    const results = detectPotentialConflicts(artifacts);
    expect(results.length).toBe(20);
  });
});
