import { describe, expect, it } from 'vitest';

import { buildTimelineExportModel } from './exportBuilder';
import type { SummaryArtifact } from '../types';

const buildArtifact = (overrides: Partial<SummaryArtifact>): SummaryArtifact => ({
  artifactId: overrides.artifactId ?? 'drive:file-1',
  source: overrides.source ?? 'drive',
  sourceId: overrides.sourceId ?? 'file-1',
  title: overrides.title ?? 'Artifact title',
  createdAtISO: overrides.createdAtISO ?? '2024-01-01T00:00:00.000Z',
  contentDateISO: overrides.contentDateISO,
  summary: overrides.summary ?? 'Summary first sentence. More detail.',
  highlights: overrides.highlights ?? ['Line one', 'Line two'],
  sourceMetadata: overrides.sourceMetadata,
  driveFolderId: overrides.driveFolderId ?? 'folder-1',
  driveFileId: overrides.driveFileId ?? 'file-1',
  driveWebViewLink: overrides.driveWebViewLink,
  model: overrides.model ?? 'stub',
  version: overrides.version ?? 1,
});

describe('buildTimelineExportModel', () => {
  it('groups artifacts by date', () => {
    const model = buildTimelineExportModel([
      { entryKey: 'a', artifact: buildArtifact({ artifactId: 'a', driveFileId: 'a', contentDateISO: '2024-01-01T00:00:00.000Z' }) },
      { entryKey: 'b', artifact: buildArtifact({ artifactId: 'b', driveFileId: 'b', contentDateISO: '2024-01-02T00:00:00.000Z' }) },
    ]);

    expect(model.groups).toHaveLength(2);
    expect(model.groups[0].label).toContain('2024');
  });

  it('handles undated artifacts', () => {
    const model = buildTimelineExportModel([
      { entryKey: 'a', artifact: buildArtifact({ artifactId: 'a', driveFileId: 'a', contentDateISO: undefined }) },
    ]);

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].label).toBe('Undated');
  });

  it('produces structured export fields', () => {
    const model = buildTimelineExportModel([
      {
        entryKey: 'a',
        artifact: buildArtifact({
          artifactId: 'a',
          driveFileId: 'a',
          summary: 'Title sentence. Another sentence.',
          highlights: ['Bullet A', 'Bullet B'],
          sourceMetadata: { subject: 'Doc subject' },
        }),
      },
    ]);

    expect(model.title).toBe('Timeline Report');
    expect(model.generatedAt).toBeTruthy();
    expect(model.artifactCount).toBe(1);
    expect(model.groups[0].items[0]).toEqual(
      expect.objectContaining({
        title: 'Title sentence.',
        bullets: ['Bullet A', 'Bullet B'],
        sourceLabel: 'Doc subject',
      }),
    );
  });
});
