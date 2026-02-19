import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../timeline/artifactIndex', () => ({ loadArtifactIndex: vi.fn(async () => ({ index: { artifacts: [] } })) }));
vi.mock('../timeline/structuredQuery', () => ({
  runStructuredQuery: vi.fn(async () => ({
    ok: true,
    query: { limitArtifacts: 30, limitItemsPerArtifact: 10 },
    totals: { artifactsMatched: 0, openLoopsMatched: 0, risksMatched: 0, decisionsMatched: 0 },
    results: [],
  })),
}));
vi.mock('../reports/saveReportToDrive', () => ({ saveReportToDrive: vi.fn(async () => ({ driveFileId: 'f1', driveFileName: 'r1.md' })) }));
vi.mock('./reportMarkers', () => ({
  readReportMarker: vi.fn(async () => null),
  writeReportMarker: vi.fn(async () => undefined),
}));

import { saveReportToDrive } from '../reports/saveReportToDrive';
import { readReportMarker, writeReportMarker } from './reportMarkers';
import { maybeGeneratePerProfileReport, resetPerProfileReportCounter } from './perProfileReports';

describe('perProfileReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPerProfileReportCounter('rk');
  });

  const baseArgs = {
    enabled: true,
    jobType: 'week_in_review' as const,
    jobId: 'weekly',
    runKey: 'rk',
    profile: { id: 'p1', name: 'Profile 1', filters: {} },
    dateWindow: { dateFromISO: '2026-01-01T00:00:00Z', dateToISO: '2026-01-08T00:00:00Z' },
    drive: {} as never,
    driveFolderId: 'folder',
  };

  it('generates report when enabled', async () => {
    const result = await maybeGeneratePerProfileReport(baseArgs);
    expect(result.report?.driveFileId).toBe('f1');
    expect(saveReportToDrive).toHaveBeenCalledTimes(1);
  });

  it('reuses marker and skips drive write', async () => {
    vi.mocked(readReportMarker).mockResolvedValueOnce({
      runKey: 'rk',
      profileId: 'p1',
      reportDriveFileId: 'existing',
      reportDriveFileName: 'existing.md',
      savedAtISO: '2026-01-01T00:00:00Z',
    });

    const result = await maybeGeneratePerProfileReport(baseArgs);
    expect(result.reused).toBe(true);
    expect(saveReportToDrive).not.toHaveBeenCalled();
  });

  it('cap reached skips further reports', async () => {
    const first = await maybeGeneratePerProfileReport({ ...baseArgs, maxPerRouteReportsPerRun: 1 });
    const second = await maybeGeneratePerProfileReport({
      ...baseArgs,
      profile: { id: 'p2', filters: {} },
      maxPerRouteReportsPerRun: 1,
    });

    expect(first.report?.driveFileId).toBe('f1');
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('cap_reached');
  });

  it('marker write failure does not throw hard', async () => {
    vi.mocked(writeReportMarker).mockRejectedValueOnce(new Error('marker fail'));
    const result = await maybeGeneratePerProfileReport(baseArgs);
    expect(result.report?.driveFileId).toBe('f1');
    expect(result.warning).toContain('marker fail');
  });
});
