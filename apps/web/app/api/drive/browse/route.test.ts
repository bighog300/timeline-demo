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

  it('defaults folder to app folder', async () => {
    listMock.mockResolvedValueOnce({ data: { files: [{ id: 'f1', name: 'Doc', mimeType: 'application/pdf' }] } });

    const response = await GET(new Request('http://localhost/api/drive/browse') as never);
    const payload = await response.json() as { folderId: string };

    expect(response.status).toBe(200);
    expect(payload.folderId).toBe('app-folder');
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ q: expect.stringContaining("'app-folder' in parents") }));
  });

  it('rejects folders outside app folder scope', async () => {
    listMock.mockResolvedValueOnce({ data: { files: [{ id: 'child-1' }] } });

    const response = await GET(new Request('http://localhost/api/drive/browse?folderId=outside') as never);

    expect(response.status).toBe(403);
  });

  it('returns items and nextPageToken', async () => {
    listMock
      .mockResolvedValueOnce({ data: { files: [{ id: 'child-1' }] } })
      .mockResolvedValueOnce({
        data: {
          files: [{ id: 'd1', name: 'Doc 1', mimeType: 'application/pdf', modifiedTime: '2024-01-01T00:00:00.000Z', webViewLink: 'https://example.com' }],
          nextPageToken: 'next-1',
        },
      });

    const response = await GET(new Request('http://localhost/api/drive/browse?folderId=child-1&pageToken=t-1') as never);
    const payload = await response.json() as { items: Array<{ id: string }>; nextPageToken: string };

    expect(response.status).toBe(200);
    expect(payload.items[0]?.id).toBe('d1');
    expect(payload.nextPageToken).toBe('next-1');
  });
});
