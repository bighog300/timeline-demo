import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
  persistDriveFolderId: vi.fn(),
}));

vi.mock('../../../../lib/appDriveFolder', () => ({
  resolveOrProvisionAppDriveFolder: vi.fn(),
  AppDriveFolderResolveError: class AppDriveFolderResolveError extends Error {
    operation = 'drive.provision';
    cause: unknown;
    constructor(cause: unknown) {
      super('failed');
      this.cause = cause;
    }
  },
}));

vi.mock('../../../../lib/googleDrive', () => ({ createDriveClient: vi.fn(() => ({})) }));

import { getGoogleAccessToken, getGoogleSession, persistDriveFolderId } from '../../../../lib/googleAuth';
import { resolveOrProvisionAppDriveFolder } from '../../../../lib/appDriveFolder';
import { POST } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockAccessToken = vi.mocked(getGoogleAccessToken);
const mockPersistDriveFolderId = vi.mocked(persistDriveFolderId);
const mockResolveOrProvisionAppDriveFolder = vi.mocked(resolveOrProvisionAppDriveFolder);

describe('POST /api/google/drive/provision', () => {
  it('returns reconnect_required when not authenticated', async () => {
    mockSession.mockResolvedValue(null);
    mockAccessToken.mockResolvedValue(null);

    const response = await POST(new Request('http://localhost/api/google/drive/provision') as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'reconnect_required' },
      error_code: 'reconnect_required',
    });
  });

  it('persists driveFolderId in auth token cookie after provisioning', async () => {
    mockSession.mockResolvedValue({ user: { email: 'a@example.com' } } as never);
    mockAccessToken.mockResolvedValue('token');
    mockResolveOrProvisionAppDriveFolder.mockResolvedValue({ id: 'folder-123', name: 'Timeline' } as never);

    const request = new Request('http://localhost/api/google/drive/provision', { method: 'POST' });
    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ folderId: 'folder-123', folderName: 'Timeline' });
    expect(mockPersistDriveFolderId).toHaveBeenCalledWith(request, expect.anything(), 'folder-123');
  });
});
