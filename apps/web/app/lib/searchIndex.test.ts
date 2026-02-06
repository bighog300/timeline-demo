import { describe, expect, it } from 'vitest';

import type { SelectionSet, SummaryArtifact } from './types';
import { findSnippet, matchSelectionSet, matchSummaryArtifact, normalizeQuery } from './searchIndex';

const baseArtifact: SummaryArtifact = {
  artifactId: 'gmail:abc',
  source: 'gmail',
  sourceId: 'abc',
  title: 'Weekly Update',
  createdAtISO: '2024-01-01T00:00:00Z',
  summary: 'We discussed the Q1 launch plan and next steps.',
  highlights: ['Launch plan approved', 'Next steps assigned'],
  sourceMetadata: {
    from: 'alice@example.com',
    subject: 'Weekly Update',
  },
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  driveWebViewLink: 'https://drive.google.com/file',
  model: 'stub',
  version: 1,
};

const baseSelection: SelectionSet = {
  id: 'set-1',
  name: 'Sprint Planning',
  createdAtISO: '2024-02-01T00:00:00Z',
  updatedAtISO: '2024-02-02T00:00:00Z',
  items: [
    { source: 'gmail', id: 'msg-1', title: 'Sprint goals' },
    { source: 'drive', id: 'file-1', title: 'Roadmap doc' },
  ],
  notes: 'Focus on launch readiness',
  version: 1,
  driveFolderId: 'folder-1',
  driveFileId: 'selection-1',
};

describe('searchIndex helpers', () => {
  it('normalizes query spacing and casing', () => {
    expect(normalizeQuery('  Hello   World ')).toBe('hello world');
  });

  it('finds snippets with ellipses', () => {
    const snippet = findSnippet('This is a longer text about the launch plan.', 'launch');
    expect(snippet).toContain('launch');
    expect(snippet.length).toBeGreaterThan(0);
  });

  it('matches summary artifacts across fields', () => {
    const result = matchSummaryArtifact(baseArtifact, 'q1 launch');
    expect(result.matched).toBe(true);
    expect(result.fields).toContain('summary');
  });

  it('matches selection sets across notes and items', () => {
    const result = matchSelectionSet(baseSelection, 'roadmap');
    expect(result.matched).toBe(true);
    expect(result.fields).toContain('items');
  });

  it('is case-insensitive', () => {
    const result = matchSelectionSet(baseSelection, 'SPRINT');
    expect(result.matched).toBe(true);
    expect(result.fields).toContain('name');
  });
});
