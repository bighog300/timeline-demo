import { describe, expect, it, vi } from 'vitest';

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
  });
});
