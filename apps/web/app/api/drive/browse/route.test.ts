import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/googleRequest', () => ({
  logGoogleError: vi.fn(),
  mapGoogleError: vi.fn(() => ({ status: 500, code: 'internal_error', message: 'boom' })),
}));

import { GET } from './route';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);

describe('GET /api/drive/browse', () => {
  const listMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'app-folder' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    listMock.mockReset();
    mockCreateDriveClient.mockReturnValue({ files: { list: listMock } } as never);
  });

  it('scope=root allows browsing root without app-folder restriction', async () => {
    listMock.mockResolvedValueOnce({ data: { files: [{ id: 'd1', name: 'Doc', mimeType: 'application/pdf' }] } });

    const response = await GET(new Request('http://localhost/api/drive/browse?scope=root') as never);
    const payload = await response.json() as { folderId: string; scope: string };

    expect(response.status).toBe(200);
    expect(payload.folderId).toBe('root');
    expect(payload.scope).toBe('root');
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ q: expect.stringContaining("'root' in parents") }));
  });

  it('scope=app enforces app-folder restrictions', async () => {
    listMock.mockResolvedValueOnce({ data: { files: [{ id: 'child-1' }] } });

    const response = await GET(new Request('http://localhost/api/drive/browse?scope=app&folderId=outside') as never);

    expect(response.status).toBe(403);
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
