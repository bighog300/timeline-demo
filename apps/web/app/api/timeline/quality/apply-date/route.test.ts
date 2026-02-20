import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/timeline/artifactIndex', () => ({
  loadArtifactIndex: vi.fn(),
  saveArtifactIndex: vi.fn(),
  upsertArtifactIndexEntry: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { loadArtifactIndex, saveArtifactIndex, upsertArtifactIndexEntry } from '../../../../lib/timeline/artifactIndex';
import { POST } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDrive = vi.mocked(createDriveClient);
const mockLoad = vi.mocked(loadArtifactIndex);
const mockSave = vi.mocked(saveArtifactIndex);
const mockUpsert = vi.mocked(upsertArtifactIndexEntry);

const baseArtifact = {
  artifactId: 'a1',
  source: 'drive',
  sourceId: 'src-1',
  title: 'A1',
  createdAtISO: '2026-01-01T00:00:00.000Z',
  summary: 'Summary',
  highlights: ['h'],
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  model: 'stub',
  version: 1,
  type: 'summary',
  status: 'complete',
  id: 'file-1',
  updatedAtISO: '2026-01-01T00:00:00.000Z',
  meta: { driveFileId: 'file-1', driveFolderId: 'folder-1', source: 'drive', sourceId: 'src-1', model: 'stub', version: 1 },
};

describe('POST /api/timeline/quality/apply-date', () => {
  it('updates contentDateISO and persists', async () => {
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'a@b.c' } } as never);
    mockAccessToken.mockResolvedValue('token');

    const get = vi.fn().mockResolvedValue({ data: baseArtifact });
    const update = vi.fn().mockResolvedValue({ data: { id: 'file-1' } });
    mockCreateDrive.mockReturnValue({ files: { get, update } } as never);

    mockLoad.mockResolvedValue({ fileId: 'idx', index: { version: 1, updatedAtISO: '2026-01-01T00:00:00.000Z', artifacts: [{ id: 'a1', driveFileId: 'file-1', title: 'A1' }] } } as never);
    mockUpsert.mockReturnValue({ version: 1, updatedAtISO: '2026-01-02T00:00:00.000Z', artifacts: [] } as never);
    mockSave.mockResolvedValue({ fileId: 'idx', index: { version: 1, updatedAtISO: '2026-01-02T00:00:00.000Z', artifacts: [] } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/quality/apply-date', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'file-1', contentDateISO: '2026-02-14T00:00:00.000Z' }),
    }) as never);

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, artifactId: 'file-1', contentDateISO: '2026-02-14T00:00:00.000Z' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
