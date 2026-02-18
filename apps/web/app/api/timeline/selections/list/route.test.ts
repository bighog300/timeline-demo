import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/driveSelections', () => ({
  listSelectionFiles: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { listSelectionFiles } from '../../../../lib/driveSelections';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockListSelectionFiles = vi.mocked(listSelectionFiles);

describe('GET /api/timeline/selections/list', () => {
  it('returns items from Drive list', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockListSelectionFiles.mockResolvedValue([
      {
        fileId: 'file-1',
        name: 'Test - Selection.json',
        modifiedTime: '2025-01-01T00:00:00.000Z',
        webViewLink: 'https://drive.google.com/file-1',
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          fileId: 'file-1',
          name: 'Test - Selection.json',
          modifiedTime: '2025-01-01T00:00:00.000Z',
          webViewLink: 'https://drive.google.com/file-1',
        },
      ],
    });
  });
});
