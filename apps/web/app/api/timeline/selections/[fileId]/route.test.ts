import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/driveSelections', () => ({
  getSelectionFileMetadata: vi.fn(),
}));

vi.mock('../../../../lib/selectionFileOps', () => ({
  deleteDriveFile: vi.fn(),
  findTimelineIndexFile: vi.fn(),
  isOwnedByFolder: vi.fn(),
  readTimelineIndexJson: vi.fn(),
  writeTimelineIndexJson: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { getSelectionFileMetadata } from '../../../../lib/driveSelections';
import {
  deleteDriveFile,
  findTimelineIndexFile,
  isOwnedByFolder,
  readTimelineIndexJson,
  writeTimelineIndexJson,
} from '../../../../lib/selectionFileOps';
import { DELETE } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockGetSelectionFileMetadata = vi.mocked(getSelectionFileMetadata);
const mockDeleteDriveFile = vi.mocked(deleteDriveFile);
const mockFindTimelineIndexFile = vi.mocked(findTimelineIndexFile);
const mockIsOwnedByFolder = vi.mocked(isOwnedByFolder);
const mockReadTimelineIndexJson = vi.mocked(readTimelineIndexJson);
const mockWriteTimelineIndexJson = vi.mocked(writeTimelineIndexJson);

describe('DELETE /api/timeline/selections/[fileId]', () => {
  it('returns 403 on folder mismatch', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockGetSelectionFileMetadata.mockResolvedValue({ data: { id: 'file-1', parents: ['other'] } } as never);
    mockIsOwnedByFolder.mockReturnValue(false);

    const response = await DELETE(new Request('http://localhost') as never, {
      params: Promise.resolve({ fileId: 'file-1' }),
    });

    expect(response.status).toBe(403);
  });

  it('deletes and updates index selectionSets when present', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockGetSelectionFileMetadata.mockResolvedValue({ data: { id: 'file-1', parents: ['folder-1'] } } as never);
    mockIsOwnedByFolder.mockReturnValue(true);
    mockFindTimelineIndexFile.mockResolvedValue('index-1');
    mockReadTimelineIndexJson.mockResolvedValue({
      version: 1,
      updatedAtISO: '2025-01-01T00:00:00.000Z',
      driveFolderId: 'folder-1',
      indexFileId: 'index-1',
      summaries: [],
      selectionSets: [
        { driveFileId: 'file-1', name: 'To remove', updatedAtISO: '2025-01-01T00:00:00.000Z' },
      ],
    } as never);

    const response = await DELETE(new Request('http://localhost') as never, {
      params: Promise.resolve({ fileId: 'file-1' }),
    });

    expect(response.status).toBe(200);
    expect(mockDeleteDriveFile).toHaveBeenCalledWith(expect.anything(), 'file-1');
    expect(mockWriteTimelineIndexJson).toHaveBeenCalledWith(
      expect.anything(),
      'index-1',
      expect.objectContaining({ selectionSets: [] }),
    );
  });
});
