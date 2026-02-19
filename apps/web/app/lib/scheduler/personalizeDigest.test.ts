import { describe, expect, it, vi } from 'vitest';

vi.mock('../timeline/artifactIndex', () => ({ loadArtifactIndex: vi.fn(async () => ({ index: { artifacts: [] } })) }));
vi.mock('../timeline/structuredQuery', () => ({ runStructuredQuery: vi.fn() }));

import { runStructuredQuery } from '../timeline/structuredQuery';
import { buildPersonalizedDigest, normalizeProfileFilters } from './personalizeDigest';

describe('personalizeDigest', () => {
  it('applies alias normalization to entities', () => {
    const filters = normalizeProfileFilters(
      { entities: ['Acme Inc'] },
      { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', aliases: [{ alias: 'acme inc', canonical: 'acme' }] },
    );

    expect(filters.entities).toEqual(['acme']);
  });

  it('respects riskSeverityMin by excluding lower severities', async () => {
    vi.mocked(runStructuredQuery).mockResolvedValueOnce({
      ok: true,
      query: { limitArtifacts: 30, limitItemsPerArtifact: 10 },
      totals: { artifactsMatched: 1, openLoopsMatched: 0, risksMatched: 2, decisionsMatched: 0 },
      results: [
        {
          artifactId: 'a1',
          matches: {
            risks: [
              { text: 'low risk', severity: 'low' },
              { text: 'high risk', severity: 'high' },
            ],
          },
        },
      ],
    } as never);

    const digest = await buildPersonalizedDigest({
      jobType: 'alerts',
      profile: { id: 'p1', to: ['a@example.com'], filters: { riskSeverityMin: 'high' } },
      jobOutput: { lookbackStartISO: '2026-01-01T00:00:00Z', nowISO: '2026-01-02T00:00:00Z' },
      drive: {} as never,
      driveFolderId: 'folder',
      now: new Date('2026-01-02T00:00:00Z'),
    });

    expect(digest.body).toContain('high risk');
    expect(digest.body).not.toContain('low risk');
  });

  it('returns compact no-updates email when scope is empty', async () => {
    vi.mocked(runStructuredQuery).mockResolvedValueOnce({
      ok: true,
      query: { limitArtifacts: 30, limitItemsPerArtifact: 10 },
      totals: { artifactsMatched: 0, openLoopsMatched: 0, risksMatched: 0, decisionsMatched: 0 },
      results: [],
    } as never);

    const digest = await buildPersonalizedDigest({
      jobType: 'week_in_review',
      profile: { id: 'p1', to: ['a@example.com'], filters: {} },
      jobOutput: { dateFromISO: '2026-01-01T00:00:00Z', dateToISO: '2026-01-08T00:00:00Z' },
      drive: {} as never,
      driveFolderId: 'folder',
      now: new Date('2026-01-08T00:00:00Z'),
    });

    expect(digest.empty).toBe(true);
    expect(digest.body).toContain('No updates in your scope');
  });
});
