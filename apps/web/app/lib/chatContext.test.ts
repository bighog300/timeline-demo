import { describe, expect, it } from 'vitest';

import { buildContextPackFromIndexData, isSummaryJsonFile } from './chatContext';
import type { TimelineIndexSummary } from './indexTypes';
import type { SummaryArtifact } from './types';

const buildArtifact = (overrides: Partial<SummaryArtifact>): SummaryArtifact => ({
  artifactId: overrides.artifactId ?? 'artifact-1',
  source: overrides.source ?? 'drive',
  sourceId: overrides.sourceId ?? 'drive:file-1',
  title: overrides.title ?? 'Launch Plan',
  createdAtISO: overrides.createdAtISO ?? '2024-01-02T00:00:00.000Z',
  summary: overrides.summary ?? 'Launch plan summary with key milestones.',
  highlights: overrides.highlights ?? ['Milestone A', 'Milestone B'],
  driveFolderId: overrides.driveFolderId ?? 'folder-1',
  driveFileId: overrides.driveFileId ?? 'summary-1',
  driveWebViewLink: overrides.driveWebViewLink,
  model: overrides.model ?? 'gpt-4o-mini',
  version: overrides.version ?? 1,
  sourceMetadata: overrides.sourceMetadata,
  sourcePreview: overrides.sourcePreview,
});

describe('chatContext', () => {
  it('returns top N items with truncated snippets from index data', () => {
    const summaries: TimelineIndexSummary[] = [
      {
        driveFileId: 'summary-1',
        title: 'Launch Plan',
        source: 'drive',
        sourceId: 'drive:file-1',
      },
      {
        driveFileId: 'summary-2',
        title: 'Budget Review',
        source: 'drive',
        sourceId: 'drive:file-2',
      },
    ];
    const longSummary = 'Launch plan details '.repeat(60);
    const artifacts = [
      buildArtifact({ driveFileId: 'summary-1', summary: longSummary }),
      buildArtifact({ driveFileId: 'summary-2', title: 'Budget Review' }),
    ];

    const pack = buildContextPackFromIndexData({
      queryText: 'launch',
      summaries,
      artifacts,
      maxItems: 1,
      maxSnippetChars: 10,
      maxContextChars: 200,
    });

    expect(pack.items).toHaveLength(1);
    expect(pack.items[0].title).toBe('Launch Plan');
    expect(pack.items[0].snippet.length).toBeGreaterThan(0);
    expect(pack.items[0].snippet).toContain('[truncated]');
  });

  it('ignores Summary.md exports when filtering listing files', () => {
    expect(isSummaryJsonFile({ name: 'Project - Summary.json' })).toBe(true);
    expect(isSummaryJsonFile({ name: 'Project - Summary.md' })).toBe(false);
  });
});
