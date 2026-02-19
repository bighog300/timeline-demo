import { describe, expect, it, vi } from 'vitest';

import { readReportMarker, reportMarkerName, writeReportMarker } from './reportMarkers';

describe('reportMarkers', () => {
  it('uses per-profile marker name format', () => {
    expect(reportMarkerName('job:window', 'p1')).toContain('__p1');
  });

  it('reads marker when available', async () => {
    const drive = {
      files: {
        list: vi.fn(async () => ({ data: { files: [{ id: 'm1' }] } })),
        get: vi.fn(async () => ({
          data: {
            runKey: 'rk',
            profileId: 'p1',
            reportDriveFileId: 'f1',
            reportDriveFileName: 'r.md',
            savedAtISO: '2026-01-01T00:00:00Z',
          },
        })),
      },
    };

    await expect(readReportMarker({ drive: drive as never, folderId: 'folder', runKey: 'rk', profileId: 'p1' })).resolves.toMatchObject({ reportDriveFileId: 'f1' });
  });

  it('writes marker with expected payload', async () => {
    const drive = {
      files: {
        create: vi.fn(async () => ({ data: { id: '1' } })),
      },
    };
    await writeReportMarker({
      drive: drive as never,
      folderId: 'folder',
      runKey: 'rk',
      profileId: 'p1',
      details: {
        runKey: 'rk',
        profileId: 'p1',
        reportDriveFileId: 'f1',
        reportDriveFileName: 'r.md',
        savedAtISO: '2026-01-01T00:00:00Z',
      },
    });

    expect(drive.files.create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({ name: expect.stringContaining('report_saved_') }),
    }));
  });
});
