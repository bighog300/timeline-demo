import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/runArtifacts', () => ({
  readRunArtifact: vi.fn(),
  updateRunArtifact: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { readRunArtifact, updateRunArtifact } from '../../../lib/runArtifacts';
import { GET, PATCH } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockReadRunArtifact = vi.mocked(readRunArtifact);
const mockUpdateRunArtifact = vi.mocked(updateRunArtifact);

describe('/api/runs/[id]', () => {
  const runArtifact = {
    id: 'run-1',
    caps: {
      maxItems: 100,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns run payload', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue({ id: 'run-1' } as never);

    const response = await GET(new Request('http://localhost/api/runs/run-1') as never, {
      params: Promise.resolve({ id: 'run-1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: { id: 'run-1' } });
  });

  it('PATCH updates run payload', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);
    mockUpdateRunArtifact.mockResolvedValue({ id: 'run-1', finishedAt: '2025-01-01T00:00:00.000Z' } as never);

    const response = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finishedAt: '2025-01-01T00:00:00.000Z', result: { status: 'success' } }),
      }) as never,
      {
        params: Promise.resolve({ id: 'run-1' }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: { id: 'run-1', finishedAt: '2025-01-01T00:00:00.000Z' } });
    expect(mockUpdateRunArtifact).toHaveBeenCalledWith(
      expect.anything(),
      'folder-1',
      'run-1',
      {
        finishedAt: '2025-01-01T00:00:00.000Z',
        result: { status: 'success' },
      },
    );
  });

  it('PATCH rejects idsIncluded=true', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);

    const response = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: { ids: null, idsIncluded: true } }),
      }) as never,
      { params: Promise.resolve({ id: 'run-1' }) },
    );

    expect(response.status).toBe(400);
    expect(mockUpdateRunArtifact).not.toHaveBeenCalled();
  });

  it('PATCH rejects ids array', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);

    const response = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: { ids: ['a'], idsIncluded: false } }),
      }) as never,
      { params: Promise.resolve({ id: 'run-1' }) },
    );

    expect(response.status).toBe(400);
    expect(mockUpdateRunArtifact).not.toHaveBeenCalled();
  });

  it('PATCH rejects unknown top-level key', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);

    const response = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      }) as never,
      { params: Promise.resolve({ id: 'run-1' }) },
    );

    expect(response.status).toBe(400);
    expect(mockUpdateRunArtifact).not.toHaveBeenCalled();
  });

  it('PATCH rejects oversized requestIds and note', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);

    const requestIdsResponse = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          result: {
            status: 'success',
            requestIds: Array.from({ length: 11 }, (_, i) => `req-${i}`),
          },
        }),
      }) as never,
      { params: Promise.resolve({ id: 'run-1' }) },
    );

    expect(requestIdsResponse.status).toBe(400);

    const noteResponse = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          result: {
            status: 'success',
            note: 'x'.repeat(501),
          },
        }),
      }) as never,
      { params: Promise.resolve({ id: 'run-1' }) },
    );

    expect(noteResponse.status).toBe(400);
    expect(mockUpdateRunArtifact).not.toHaveBeenCalled();
  });

  it('PATCH rejects invalid finishedAt', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);

    const response = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finishedAt: 'not-a-date' }),
      }) as never,
      { params: Promise.resolve({ id: 'run-1' }) },
    );

    expect(response.status).toBe(400);
    expect(mockUpdateRunArtifact).not.toHaveBeenCalled();
  });

  it('PATCH accepts valid patch and only sends safe fields', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);
    mockUpdateRunArtifact.mockResolvedValue({ id: 'run-1', finishedAt: '2025-01-01T00:00:00.000Z' } as never);

    const response = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          finishedAt: '2025-01-01T00:00:00.000Z',
          result: {
            status: 'partial_success',
            processedCount: 10,
            failedCount: 2,
            requestIds: ['abc'],
            note: 'done',
            ignored: 'bad',
          },
          items: {
            ids: null,
            idsIncluded: false,
          },
        }),
      }) as never,
      {
        params: Promise.resolve({ id: 'run-1' }),
      },
    );

    expect(response.status).toBe(400);
  });

  it('PATCH accepts valid patch payload', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadRunArtifact.mockResolvedValue(runArtifact as never);
    mockUpdateRunArtifact.mockResolvedValue({ id: 'run-1', finishedAt: '2025-01-01T00:00:00.000Z' } as never);

    const response = await PATCH(
      new Request('http://localhost/api/runs/run-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          finishedAt: '2025-01-01T00:00:00.000Z',
          result: {
            status: 'partial_success',
            processedCount: 10,
            failedCount: 2,
            requestIds: ['abc'],
            note: 'done',
          },
          items: {
            ids: null,
            idsIncluded: false,
          },
        }),
      }) as never,
      {
        params: Promise.resolve({ id: 'run-1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(mockUpdateRunArtifact).toHaveBeenCalledWith(
      expect.anything(),
      'folder-1',
      'run-1',
      {
        finishedAt: '2025-01-01T00:00:00.000Z',
        result: {
          status: 'partial_success',
          processedCount: 10,
          failedCount: 2,
          requestIds: ['abc'],
          note: 'done',
        },
        items: {
          ids: null,
          idsIncluded: false,
        },
      },
    );
  });
});
