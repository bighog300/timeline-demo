import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/timeline/artifactIndex', () => ({
  loadArtifactIndex: vi.fn().mockResolvedValue({
    index: { version: 1, updatedAtISO: '2024-01-01T00:00:00Z', artifacts: [{ id: 'gmail:1', driveFileId: 'artifact-file-1', openLoopsCount: 1 }] },
    fileId: 'index-1',
  }),
  saveArtifactIndex: vi.fn(),
  upsertArtifactIndexEntry: vi.fn((index, entry) => ({ ...index, artifacts: [entry] })),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { saveArtifactIndex, upsertArtifactIndexEntry } from '../../../lib/timeline/artifactIndex';
import { POST } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDrive = vi.mocked(createDriveClient);

const artifact = {
  type: 'summary',
  status: 'complete',
  id: 'artifact-file-1',
  artifactId: 'gmail:1',
  source: 'gmail',
  sourceId: '1',
  title: 'Title',
  createdAtISO: '2024-01-01T00:00:00Z',
  updatedAtISO: '2024-01-01T00:00:00Z',
  summary: 'summary',
  highlights: [],
  driveFolderId: 'folder-1',
  driveFileId: 'artifact-file-1',
  model: 'stub',
  version: 1,
  meta: { driveFileId: 'artifact-file-1', driveFolderId: 'folder-1', source: 'gmail', sourceId: '1', model: 'stub', version: 1 },
  openLoops: [{ text: 'Follow up with legal', status: 'open' as const }],
};

describe('POST /api/timeline/open-loops', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'test@example.com' } } as never);
    mockToken.mockResolvedValue('token');
  });

  it('returns 401 when unauthenticated', async () => {
    mockSession.mockResolvedValue(null);
    mockToken.mockResolvedValue(null);
    const response = await POST(new Request('http://localhost/api/timeline/open-loops', { method: 'POST', body: JSON.stringify({ artifactId: 'a', openLoopIndex: 0, action: 'close' }) }) as never);
    expect(response.status).toBe(401);
  });

  it('close loop sets status and closedAtISO and persists', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    mockDrive.mockReturnValue({ files: { get: vi.fn().mockResolvedValue({ data: artifact }), update } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/open-loops', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', openLoopIndex: 0, action: 'close', patch: { closedReason: 'Done' } }),
    }) as never);

    expect(response.status).toBe(200);
    const persisted = JSON.parse(update.mock.calls[0][0].media.body as string);
    expect(persisted.openLoops[0].status).toBe('closed');
    expect(persisted.openLoops[0].closedAtISO).toBeDefined();
    expect(persisted.openLoops[0].closedReason).toBe('Done');
  });

  it('reopen clears closed fields and persists', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    mockDrive.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({ data: { ...artifact, openLoops: [{ text: 'Follow up with legal', status: 'closed', closedAtISO: '2024-01-02T00:00:00Z', closedReason: 'Done' }] } }),
        update,
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/timeline/open-loops', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', openLoopIndex: 0, action: 'reopen' }),
    }) as never);

    expect(response.status).toBe(200);
    const persisted = JSON.parse(update.mock.calls[0][0].media.body as string);
    expect(persisted.openLoops[0].status).toBe('open');
    expect(persisted.openLoops[0].closedAtISO).toBeNull();
    expect(persisted.openLoops[0].closedReason).toBeNull();
  });

  it('edit updates text/owner/dueDateISO', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    mockDrive.mockReturnValue({ files: { get: vi.fn().mockResolvedValue({ data: artifact }), update } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/open-loops', {
      method: 'POST',
      body: JSON.stringify({
        artifactId: 'artifact-file-1',
        openLoopText: 'Follow up with legal',
        action: 'edit',
        patch: { text: 'Follow up with legal team', owner: 'Alex', dueDateISO: '2026-01-04T00:00:00Z' },
      }),
    }) as never);

    expect(response.status).toBe(200);
    const persisted = JSON.parse(update.mock.calls[0][0].media.body as string);
    expect(persisted.openLoops[0].text).toBe('Follow up with legal team');
    expect(persisted.openLoops[0].owner).toBe('Alex');
    expect(persisted.openLoops[0].dueDateISO).toBe('2026-01-04T00:00:00Z');
  });

  it('returns 404 for invalid selector', async () => {
    mockDrive.mockReturnValue({ files: { get: vi.fn().mockResolvedValue({ data: artifact }), update: vi.fn() } } as never);
    const response = await POST(new Request('http://localhost/api/timeline/open-loops', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', openLoopIndex: 3, action: 'close' }),
    }) as never);
    expect(response.status).toBe(404);
  });

  it('best-effort index update is called', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    mockDrive.mockReturnValue({ files: { get: vi.fn().mockResolvedValue({ data: artifact }), update } } as never);

    await POST(new Request('http://localhost/api/timeline/open-loops', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', openLoopIndex: 0, action: 'close' }),
    }) as never);

    expect(upsertArtifactIndexEntry).toHaveBeenCalled();
    expect(saveArtifactIndex).toHaveBeenCalled();
  });
});
