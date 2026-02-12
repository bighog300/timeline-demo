import { describe, expect, it } from 'vitest';

import {
  buildContextPackFromIndexData,
  buildContextString,
  isSummaryJsonFile,
  type ChatRunContextItem,
  type ChatSelectionSetContextItem,
} from './chatContext';
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
    expect(pack.items[0].kind).toBe('summary');
    if (pack.items[0].kind === 'summary') {
      expect(pack.items[0].snippet.length).toBeGreaterThan(0);
      expect(pack.items[0].snippet).toContain('[truncated]');
    }
  });

  it('includes metadata-only selection set and run items inside maxContextItems cap', () => {
    const summaries: TimelineIndexSummary[] = [
      {
        driveFileId: 'summary-1',
        title: 'Launch Plan',
        source: 'drive',
        sourceId: 'drive:file-1',
      },
      {
        driveFileId: 'summary-2',
        title: 'Litigation Notes',
        source: 'gmail',
        sourceId: 'msg-2',
      },
      {
        driveFileId: 'summary-3',
        title: 'Team Followup',
        source: 'gmail',
        sourceId: 'msg-3',
      },
    ];
    const artifacts = [
      buildArtifact({ driveFileId: 'summary-1', summary: 'Summary 1', title: 'Launch Plan' }),
      buildArtifact({ driveFileId: 'summary-2', summary: 'Summary 2', title: 'Litigation Notes', source: 'gmail' }),
      buildArtifact({ driveFileId: 'summary-3', summary: 'Summary 3', title: 'Team Followup', source: 'gmail' }),
    ];

    const selectionSets: ChatSelectionSetContextItem[] = [
      {
        kind: 'selection_set',
        id: 'set-1',
        title: 'Employment Dispute Search',
        source: 'gmail',
        q: 'from:manager termination',
        updatedAtISO: '2024-04-10T10:00:00.000Z',
        text: 'Saved search: Employment Dispute Search (source: gmail). Query: from:manager termination. Updated: 2024-04-10T10:00:00.000Z.',
      },
      {
        kind: 'selection_set',
        id: 'set-2',
        title: 'Drive Contracts',
        source: 'drive',
        q: 'contract nda',
        updatedAtISO: '2024-04-09T10:00:00.000Z',
        text: 'Saved search: Drive Contracts (source: drive). Query: contract nda. Updated: 2024-04-09T10:00:00.000Z.',
      },
    ];

    const runs: ChatRunContextItem[] = [
      {
        kind: 'run',
        id: 'run-1',
        action: 'summarize',
        selectionSetId: 'set-1',
        selectionSetTitle: 'Employment Dispute Search',
        startedAtISO: '2024-04-10T10:10:00.000Z',
        finishedAtISO: '2024-04-10T10:11:00.000Z',
        status: 'partial_success',
        foundCount: 10,
        processedCount: 8,
        failedCount: 2,
        requestIds: ['req-1', 'req-2'],
        text: 'Run action: summarize. Status: partial_success. Counts: found=10, processed=8, failed=2.',
      },
      {
        kind: 'run',
        id: 'run-2',
        action: 'chat_originals_opened',
        startedAtISO: '2024-04-10T11:00:00.000Z',
        finishedAtISO: '2024-04-10T11:01:00.000Z',
        status: 'success',
        processedCount: 2,
        failedCount: 0,
        requestIds: ['req-3'],
        text: 'Chat opened originals for 2 sources (metadata only).',
      },
      {
        kind: 'run',
        id: 'run-3',
        action: 'run',
        selectionSetId: 'set-2',
        selectionSetTitle: 'Drive Contracts',
        startedAtISO: '2024-04-08T11:00:00.000Z',
        finishedAtISO: '2024-04-08T11:10:00.000Z',
        status: 'success',
        foundCount: 4,
        processedCount: 4,
        failedCount: 0,
        requestIds: ['req-4'],
        text: 'Run action: run. Status: success. Counts: found=4, processed=4, failed=0.',
      },
    ];

    const pack = buildContextPackFromIndexData({
      queryText: 'employment updates',
      summaries,
      artifacts,
      selectionSets,
      runs,
      maxItems: 8,
      maxContextChars: 5000,
    });

    expect(pack.items.length).toBeLessThanOrEqual(8);
    const meta = pack.items.filter((item) => item.kind !== 'summary');
    expect(meta.length).toBeGreaterThan(0);
    expect(meta.length).toBeLessThanOrEqual(2);

    for (const item of meta) {
      if (item.kind === 'selection_set') {
        expect(item.text).toContain('Saved search:');
        expect(item.text).not.toContain('body');
      }
      if (item.kind === 'run') {
        expect(item.text).not.toMatch(/\b(content|body)\b/i);
      }
    }
  });

  it('formats context block labels for saved search and run kinds', () => {
    const { context } = buildContextString([
      {
        artifactId: 'sum-1',
        title: 'Summary Doc',
        kind: 'summary',
        source: 'drive',
        sourceId: 'src-1',
        snippet: 'Summary text',
      },
      {
        kind: 'selection_set',
        id: 'set-1',
        title: 'Saved Set',
        source: 'gmail',
        q: 'from:alice',
        updatedAtISO: '2024-05-01T00:00:00.000Z',
        text: 'Saved search metadata only.',
      },
      {
        kind: 'run',
        id: 'run-1',
        action: 'run',
        status: 'success',
        startedAtISO: '2024-05-01T00:00:00.000Z',
        text: 'Run metadata only.',
      },
    ]);

    expect(context).toContain('(SUMMARY)');
    expect(context).toContain('(SAVED SEARCH)');
    expect(context).toContain('(RUN)');
  });



  it('uses most recent summaries fallback in synthesis mode when relevance yields fewer than 2', () => {
    const summaries: TimelineIndexSummary[] = [
      {
        driveFileId: 'summary-1',
        title: 'Old Planning Notes',
        source: 'drive',
        sourceId: 'drive:file-1',
        updatedAtISO: '2024-04-01T00:00:00.000Z',
      },
      {
        driveFileId: 'summary-2',
        title: 'Mid Project Recap',
        source: 'drive',
        sourceId: 'drive:file-2',
        updatedAtISO: '2024-04-02T00:00:00.000Z',
      },
      {
        driveFileId: 'summary-3',
        title: 'Newest Incident Notes',
        source: 'drive',
        sourceId: 'drive:file-3',
        updatedAtISO: '2024-04-03T00:00:00.000Z',
      },
    ];

    const artifacts = [
      buildArtifact({ driveFileId: 'summary-1', title: 'Old Planning Notes', summary: 'older summary' }),
      buildArtifact({ driveFileId: 'summary-2', title: 'Mid Project Recap', summary: 'mid summary' }),
      buildArtifact({ driveFileId: 'summary-3', title: 'Newest Incident Notes', summary: 'newest summary' }),
    ];

    const pack = buildContextPackFromIndexData({
      queryText: 'incident',
      summaries,
      artifacts,
      maxItems: 6,
      synthesisMode: true,
    });

    const summaryItems = pack.items.filter((item) => item.kind === 'summary');
    expect(summaryItems.length).toBeGreaterThanOrEqual(2);
    expect(summaryItems[0]?.title).toBe('Newest Incident Notes');
    expect(summaryItems[1]?.title).toBe('Mid Project Recap');
  });

  it('does not force fallback summaries when synthesis mode is disabled', () => {
    const summaries: TimelineIndexSummary[] = [
      {
        driveFileId: 'summary-1',
        title: 'Old Planning Notes',
        source: 'drive',
        sourceId: 'drive:file-1',
        updatedAtISO: '2024-04-01T00:00:00.000Z',
      },
      {
        driveFileId: 'summary-2',
        title: 'Mid Project Recap',
        source: 'drive',
        sourceId: 'drive:file-2',
        updatedAtISO: '2024-04-02T00:00:00.000Z',
      },
      {
        driveFileId: 'summary-3',
        title: 'Newest Incident Notes',
        source: 'drive',
        sourceId: 'drive:file-3',
        updatedAtISO: '2024-04-03T00:00:00.000Z',
      },
    ];

    const artifacts = [
      buildArtifact({ driveFileId: 'summary-1', title: 'Old Planning Notes', summary: 'older summary' }),
      buildArtifact({ driveFileId: 'summary-2', title: 'Mid Project Recap', summary: 'mid summary' }),
      buildArtifact({ driveFileId: 'summary-3', title: 'Newest Incident Notes', summary: 'newest summary' }),
    ];

    const pack = buildContextPackFromIndexData({
      queryText: 'incident',
      summaries,
      artifacts,
      maxItems: 6,
      synthesisMode: false,
    });

    const summaryItems = pack.items.filter((item) => item.kind === 'summary');
    expect(summaryItems).toHaveLength(1);
    expect(summaryItems[0]?.title).toBe('Newest Incident Notes');
  });

  it('returns one summary in synthesis mode when only one valid summary exists', () => {
    const summaries: TimelineIndexSummary[] = [
      {
        driveFileId: 'summary-1',
        title: 'Newest Incident Notes',
        source: 'drive',
        sourceId: 'drive:file-1',
        updatedAtISO: '2024-04-03T00:00:00.000Z',
      },
    ];

    const artifacts = [
      buildArtifact({ driveFileId: 'summary-1', title: 'Newest Incident Notes', summary: 'newest summary' }),
    ];

    const pack = buildContextPackFromIndexData({
      queryText: 'generic request',
      summaries,
      artifacts,
      maxItems: 6,
      synthesisMode: true,
    });

    const summaryItems = pack.items.filter((item) => item.kind === 'summary');
    expect(summaryItems).toHaveLength(1);
  });

  it('ignores Summary.md exports when filtering listing files', () => {
    expect(isSummaryJsonFile({ name: 'Project - Summary.json' })).toBe(true);
    expect(isSummaryJsonFile({ name: 'Project - Summary.md' })).toBe(false);
  });
});
