import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({ getGoogleSession: vi.fn(), getGoogleAccessToken: vi.fn() }));
vi.mock('../../../../lib/googleDrive', () => ({ createDriveClient: vi.fn() }));
vi.mock('../../../../lib/timeline/artifactIndex', () => ({ loadArtifactIndex: vi.fn() }));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { loadArtifactIndex } from '../../../../lib/timeline/artifactIndex';
import { POST } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDrive = vi.mocked(createDriveClient);
const mockLoad = vi.mocked(loadArtifactIndex);

describe('POST /api/timeline/reports/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockToken.mockResolvedValue('token');
    mockLoad.mockResolvedValue({ fileId: 'idx', index: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', artifacts: [{ id: 'a1', driveFileId: 'f1' }] } } as never);
  });

  it('requires auth', async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await POST(new Request('http://localhost/api/timeline/reports/export', { method: 'POST', body: '{}' }) as never);
    expect(res.status).toBe(401);
  });

  it('rejects invalid request', async () => {
    const res = await POST(new Request('http://localhost/api/timeline/reports/export', { method: 'POST', body: '{}' }) as never);
    expect(res.status).toBe(400);
  });

  it('saves drive file for query export', async () => {
    const drive = { files: { get: vi.fn().mockResolvedValue({ data: { artifactId: 'a1', source: 'gmail', sourceId: '1', title: 'A1', createdAtISO: '2026-01-01T00:00:00Z', summary: 'S', highlights: ['h'], driveFolderId: 'folder-1', driveFileId: 'f1', model: 'm', version: 1 } }), create: vi.fn().mockResolvedValue({ data: { id: 'r1', name: 'report.md' } }) } };
    mockDrive.mockReturnValue(drive as never);

    const res = await POST(new Request('http://localhost/api/timeline/reports/export', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My report', format: 'markdown', query: { limitArtifacts: 5 } }),
    }) as never);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.report.driveFileId).toBe('r1');
  });

  it('returns no file id when saveToDrive false', async () => {
    const drive = { files: { get: vi.fn().mockResolvedValue({ data: { artifactId: 'a1', source: 'gmail', sourceId: '1', title: 'A1', createdAtISO: '2026-01-01T00:00:00Z', summary: 'S', highlights: ['h'], driveFolderId: 'folder-1', driveFileId: 'f1', model: 'm', version: 1 } }) } };
    mockDrive.mockReturnValue(drive as never);

    const res = await POST(new Request('http://localhost/api/timeline/reports/export', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My report', format: 'markdown', query: { limitArtifacts: 5 }, saveToDrive: false }),
    }) as never);
    const payload = await res.json();
    expect(payload.report.driveFileId).toBeUndefined();
  });
});
