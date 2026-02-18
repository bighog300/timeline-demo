import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/adminAuth', () => ({
  isAdminSession: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { isAdminSession } from '../../../../lib/adminAuth';
import { GET, PUT } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDriveClient = vi.mocked(createDriveClient);
const mockIsAdmin = vi.mocked(isAdminSession);

describe('admin entity aliases API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'admin@example.com' } } as never);
    mockToken.mockResolvedValue('token');
    mockIsAdmin.mockReturnValue(true);
  });

  it('requires admin access', async () => {
    mockIsAdmin.mockReturnValue(false);
    const response = await GET(new Request('http://localhost/api/admin/entities/aliases') as never);
    expect(response.status).toBe(403);
  });

  it('get creates default aliases file when missing', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 'aliases-file', webViewLink: 'https://drive.google.com/aliases-file' } });
    const list = vi.fn().mockResolvedValueOnce({ data: { files: [] } }).mockResolvedValueOnce({ data: { files: [] } });
    mockDriveClient.mockReturnValue({ files: { list, create, get: vi.fn(), update: vi.fn() } } as never);

    const response = await GET(new Request('http://localhost/api/admin/entities/aliases') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.aliases.version).toBe(1);
    expect(body.aliases.aliases).toEqual([]);
    expect(create).toHaveBeenCalled();
  });

  it('put validates and persists normalized aliases', async () => {
    const list = vi.fn().mockResolvedValue({ data: { files: [{ id: 'aliases-file' }] } });
    const update = vi.fn().mockResolvedValue({ data: { id: 'aliases-file', webViewLink: 'https://drive.google.com/aliases-file' } });
    mockDriveClient.mockReturnValue({ files: { list, update, create: vi.fn(), get: vi.fn() } } as never);

    const response = await PUT(new Request('http://localhost/api/admin/entities/aliases', {
      method: 'PUT',
      body: JSON.stringify({ aliases: [{ alias: 'Acme Ltd UK', canonical: 'Acme', displayName: 'ACME' }] }),
    }) as never);

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.aliases.aliases[0].alias).toBe('acme ltd uk');
    expect(body.aliases.aliases[0].canonical).toBe('acme');
    expect(update).toHaveBeenCalled();
  });
});
