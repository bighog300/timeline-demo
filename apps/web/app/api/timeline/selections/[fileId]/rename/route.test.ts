import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../../lib/driveSelections', () => ({
  getSelectionFileMetadata: vi.fn(),
  readDriveSelectionJson: vi.fn(),
  SELECTION_FILE_SUFFIX: ' - Selection.json',
}));

vi.mock('../../../../../lib/selectionFileOps', () => ({
  isOwnedByFolder: vi.fn(),
  updateSelectionFile: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../../lib/googleAuth';
import { createDriveClient } from '../../../../../lib/googleDrive';
import { getSelectionFileMetadata, readDriveSelectionJson } from '../../../../../lib/driveSelections';
import { isOwnedByFolder, updateSelectionFile } from '../../../../../lib/selectionFileOps';
import { PATCH } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockGetSelectionFileMetadata = vi.mocked(getSelectionFileMetadata);
const mockReadDriveSelectionJson = vi.mocked(readDriveSelectionJson);
const mockIsOwnedByFolder = vi.mocked(isOwnedByFolder);
const mockUpdateSelectionFile = vi.mocked(updateSelectionFile);

describe('PATCH /api/timeline/selections/[fileId]/rename', () => {
  it('returns 400 on invalid name', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const response = await PATCH(
      new Request('http://localhost/api/timeline/selections/file-1/rename', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'x' }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('returns 403 on folder mismatch', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockGetSelectionFileMetadata.mockResolvedValue({ data: { id: 'file-1', parents: ['other'] } } as never);
    mockIsOwnedByFolder.mockReturnValue(false);

    const response = await PATCH(
      new Request('http://localhost/api/timeline/selections/file-1/rename', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Valid Name' }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(403);
  });

  it('updates file name and JSON name on success', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockGetSelectionFileMetadata.mockResolvedValue({ data: { id: 'file-1', parents: ['folder-1'] } } as never);
    mockIsOwnedByFolder.mockReturnValue(true);
    mockReadDriveSelectionJson.mockResolvedValue({
      id: 'file-1',
      name: 'Old',
      createdAtISO: '2025-01-01T00:00:00.000Z',
      updatedAtISO: '2025-01-01T00:00:00.000Z',
      items: [],
      version: 1,
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
    } as never);
    mockUpdateSelectionFile.mockResolvedValue({
      data: {
        id: 'file-1',
        name: 'New Name - Selection.json',
        webViewLink: 'https://drive.google.com/file-1',
        modifiedTime: '2025-01-02T00:00:00.000Z',
      },
    } as never);

    const response = await PATCH(
      new Request('http://localhost/api/timeline/selections/file-1/rename', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Name' }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mockUpdateSelectionFile).toHaveBeenCalledWith(
      expect.anything(),
      'file-1',
      'New Name - Selection.json',
      expect.stringContaining('"name": "New Name"'),
    );
  });
});
