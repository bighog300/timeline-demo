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

import { POST } from './route';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDrive = vi.mocked(createDriveClient);

describe('POST /api/drive/resolve-selection', () => {
  const listMock = vi.fn();
  const getMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'app-folder' } as never);
    mockToken.mockResolvedValue('token');
    listMock.mockReset();
    getMock.mockReset();
    mockDrive.mockReturnValue({ files: { list: listMock, get: getMock } } as never);
  });

  it('expands nested folders recursively', async () => {
    listMock
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-a', mimeType: 'application/vnd.google-apps.folder' }, { id: 'file-1', name: 'A', mimeType: 'application/pdf' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'file-2', name: 'B', mimeType: 'application/pdf' }] } });

    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ scope: 'root', items: [{ id: 'folder-root', isFolder: true }], mimeGroup: 'all', dryRun: false }),
    }) as never);

    const payload = await response.json() as { foundFiles: number; files: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(payload.foundFiles).toBe(2);
    expect(payload.files.map((f) => f.id)).toEqual(['file-1', 'file-2']);
  });

  it('respects limit and marks truncated', async () => {
    listMock.mockResolvedValueOnce({
      data: {
        files: Array.from({ length: 5 }, (_, idx) => ({ id: `f-${idx}`, name: `F${idx}`, mimeType: 'application/pdf' })),
      },
    });

    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ scope: 'root', items: [{ id: 'folder-root', isFolder: true }], mimeGroup: 'all', limit: 3, dryRun: false }),
    }) as never);

    const payload = await response.json() as { foundFiles: number; truncated: boolean; files: Array<{ id: string }> };
    expect(payload.foundFiles).toBe(3);
    expect(payload.truncated).toBe(true);
    expect(payload.files).toHaveLength(3);
  });

  it('filters by mimeGroup and dryRun returns sample only', async () => {
    listMock.mockResolvedValueOnce({
      data: {
        files: [
          { id: 'doc-1', name: 'Doc', mimeType: 'application/vnd.google-apps.document' },
          { id: 'pdf-1', name: 'Pdf', mimeType: 'application/pdf' },
        ],
      },
    });

    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ scope: 'root', items: [{ id: 'folder-root', isFolder: true }], mimeGroup: 'docs', dryRun: true }),
    }) as never);

    const payload = await response.json() as { dryRun: boolean; foundFiles: number; files: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(payload.dryRun).toBe(true);
    expect(payload.foundFiles).toBe(1);
    expect(payload.files.map((f) => f.id)).toEqual(['doc-1']);
  });
});
