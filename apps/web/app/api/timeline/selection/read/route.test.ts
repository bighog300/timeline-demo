import { describe, expect, it, vi } from 'vitest';

import { OutsideFolderError } from '../../../../lib/driveSafety';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(() => ({})),
}));

vi.mock('../../../../lib/readSelectionSetFromDrive', () => ({
  readSelectionSetFromDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockReadSelectionSetFromDrive = vi.mocked(readSelectionSetFromDrive);

describe('GET /api/timeline/selection/read', () => {
  it('returns forbidden_outside_folder when selection set is outside folder', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockReadSelectionSetFromDrive.mockRejectedValue(new OutsideFolderError('file-1'));

    const request = new Request('http://localhost/api/timeline/selection/read?fileId=file-1') as never;
    (request as { nextUrl?: URL }).nextUrl = new URL(
      'http://localhost/api/timeline/selection/read?fileId=file-1',
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'forbidden_outside_folder',
        message: 'Selection set is outside the app folder.',
      },
      error_code: 'forbidden_outside_folder',
    });
  });
});
