import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));
vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(() => ({})),
}));
vi.mock('../../../lib/scheduler/scheduleConfigDrive', () => ({
  readScheduleConfigFromDrive: vi.fn(),
  writeScheduleConfigToDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { readScheduleConfigFromDrive, writeScheduleConfigToDrive } from '../../../lib/scheduler/scheduleConfigDrive';
import { GET, PUT } from './route';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockRead = vi.mocked(readScheduleConfigFromDrive);
const mockWrite = vi.mocked(writeScheduleConfigToDrive);

describe('/api/admin/schedules', () => {
  it('returns forbidden for non-admin users', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockSession.mockResolvedValue({ user: { email: 'user@example.com' }, driveFolderId: 'folder-1' } as never);
    mockToken.mockResolvedValue('token');

    const response = await GET(new Request('http://localhost/api/admin/schedules') as never);
    expect(response.status).toBe(403);
  });

  it('creates default config on GET when missing', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockSession.mockResolvedValue({ user: { email: 'admin@example.com' }, driveFolderId: 'folder-1' } as never);
    mockToken.mockResolvedValue('token');
    mockRead.mockResolvedValue({
      config: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', jobs: [] },
      fileId: 'file-1',
      webViewLink: undefined,
    });

    const response = await GET(new Request('http://localhost/api/admin/schedules') as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      config: { version: 1, jobs: [] },
      driveFileId: 'file-1',
    });
  });

  it('validates payload on PUT', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockSession.mockResolvedValue({ user: { email: 'admin@example.com' }, driveFolderId: 'folder-1' } as never);
    mockToken.mockResolvedValue('token');

    const response = await PUT(new Request('http://localhost/api/admin/schedules', {
      method: 'PUT',
      body: JSON.stringify({ version: 1, updatedAtISO: 'x', jobs: [] }),
    }) as never);

    expect(response.status).toBe(400);
  });

  it('saves valid payload on PUT', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    mockSession.mockResolvedValue({ user: { email: 'admin@example.com' }, driveFolderId: 'folder-1' } as never);
    mockToken.mockResolvedValue('token');
    mockRead.mockResolvedValue({
      config: { version: 1, updatedAtISO: '2026-01-01T00:00:00Z', jobs: [] },
      fileId: 'file-1',
      webViewLink: undefined,
    });
    mockWrite.mockResolvedValue({ fileId: 'file-1', webViewLink: undefined });

    const response = await PUT(new Request('http://localhost/api/admin/schedules', {
      method: 'PUT',
      body: JSON.stringify({
        version: 1,
        updatedAtISO: '2026-01-01T00:00:00Z',
        jobs: [{
          id: 'j1',
          type: 'week_in_review',
          enabled: true,
          schedule: { cron: '*/5 * * * *', timezone: 'UTC' },
        }],
      }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mockWrite).toHaveBeenCalled();
  });
});
