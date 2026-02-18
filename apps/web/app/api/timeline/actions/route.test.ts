import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/timeline/artifactIndex', () => ({
  loadArtifactIndex: vi.fn().mockResolvedValue({ index: { version: 1, updatedAtISO: '2024-01-01T00:00:00Z', artifacts: [] }, fileId: 'index-1' }),
  saveArtifactIndex: vi.fn(),
  upsertArtifactIndexEntry: vi.fn((index, entry) => ({ ...index, artifacts: [entry] })),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);

const buildArtifact = () => ({
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
  suggestedActions: [
    { id: 'act-1', type: 'task', text: 'Do it', status: 'proposed', createdAtISO: '2024-01-01T00:00:00Z', updatedAtISO: '2024-01-01T00:00:00Z' },
  ],
});

describe('POST /api/timeline/actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'test@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await POST(new Request('http://localhost/api/timeline/actions', { method: 'POST', body: JSON.stringify({ artifactId: 'a', actionId: 'b', decision: 'accept' }) }) as never);
    expect(response.status).toBe(401);
  });

  it('accept action updates status and persists', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    const get = vi.fn().mockResolvedValue({ data: buildArtifact() });
    mockCreateDriveClient.mockReturnValue({ files: { get, update, list: vi.fn().mockResolvedValue({ data: { files: [] } }), create: vi.fn() } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'act-1', decision: 'accept' }),
    }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('accepted');
    expect(update).toHaveBeenCalled();
    const body = JSON.parse(update.mock.calls[0][0].media.body as string);
    expect(body.suggestedActions[0].status).toBe('accepted');
  });

  it('dismiss action updates status and persists', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact() }),
        update,
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        create: vi.fn(),
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'act-1', decision: 'dismiss' }),
    }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('dismissed');
  });

  it('returns 404 when action is not found', async () => {
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact() }),
        update: vi.fn(),
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        create: vi.fn(),
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'missing', decision: 'dismiss' }),
    }) as never);

    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid request', async () => {
    mockCreateDriveClient.mockReturnValue({ files: { get: vi.fn(), update: vi.fn(), list: vi.fn(), create: vi.fn() } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: '', decision: 'dismiss' }),
    }) as never);

    expect(response.status).toBe(400);
  });
});
