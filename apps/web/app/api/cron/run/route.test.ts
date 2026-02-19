import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleServiceAuth', () => ({ getGoogleAccessTokenForCron: vi.fn() }));
vi.mock('../../../lib/googleDrive', () => ({ createDriveClient: vi.fn(() => ({})) }));
vi.mock('../../../lib/appDriveFolder', () => ({ resolveOrProvisionAppDriveFolder: vi.fn() }));
vi.mock('../../../lib/scheduler/scheduleConfigDrive', () => ({ readScheduleConfigFromDrive: vi.fn() }));
vi.mock('../../../lib/scheduler/runJobs', () => ({
  runWeekInReviewJob: vi.fn(),
  runAlertsJob: vi.fn(),
  appendJobRunLog: vi.fn(),
  saveNoticeToDrive: vi.fn(),
}));

import { resolveOrProvisionAppDriveFolder } from '../../../lib/appDriveFolder';
import { getGoogleAccessTokenForCron } from '../../../lib/googleServiceAuth';
import { appendJobRunLog, runAlertsJob, runWeekInReviewJob, saveNoticeToDrive } from '../../../lib/scheduler/runJobs';
import { readScheduleConfigFromDrive } from '../../../lib/scheduler/scheduleConfigDrive';
import { POST } from './route';

const mockAuth = vi.mocked(getGoogleAccessTokenForCron);
const mockFolder = vi.mocked(resolveOrProvisionAppDriveFolder);
const mockRead = vi.mocked(readScheduleConfigFromDrive);

describe('/api/cron/run', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T09:00:00Z'));
  });

  it('rejects invalid secret', async () => {
    const response = await POST(new Request('http://localhost/api/cron/run', { method: 'POST' }) as never);
    expect(response.status).toBe(401);
  });

  it('records missing refresh token cleanly', async () => {
    mockAuth.mockResolvedValue({ ok: false, error: 'missing_refresh_token' });
    const response = await POST(new Request('http://localhost/api/cron/run', { headers: { Authorization: 'Bearer secret' } }) as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ranJobs: [{ ok: false, error: 'missing_refresh_token' }],
    });
  });

  it('runs due week in review job', async () => {
    mockAuth.mockResolvedValue({ ok: true, accessToken: 'token' });
    mockFolder.mockResolvedValue({ id: 'folder-1', name: 'f' });
    mockRead.mockResolvedValue({
      config: {
        version: 1,
        updatedAtISO: '2026-01-05T00:00:00Z',
        jobs: [{ id: 'week', type: 'week_in_review', enabled: true, schedule: { cron: '0 9 * * MON', timezone: 'UTC' } }],
      },
      fileId: 'cfg-1',
      webViewLink: undefined,
    });
    vi.mocked(runWeekInReviewJob).mockResolvedValue({ reportDriveFileId: 'r1', reportDriveFileName: 'report.md' });
    vi.mocked(saveNoticeToDrive).mockResolvedValue({ noticeDriveFileId: 'n1', noticeDriveFileName: 'notice.md' });

    const response = await POST(new Request('http://localhost/api/cron/run', { headers: { Authorization: 'Bearer secret' } }) as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(runWeekInReviewJob).toHaveBeenCalled();
    expect(appendJobRunLog).toHaveBeenCalled();
    expect(json.ranJobs[0].ok).toBe(true);
  });

  it('runs alerts job with bounded query inputs', async () => {
    mockAuth.mockResolvedValue({ ok: true, accessToken: 'token' });
    mockFolder.mockResolvedValue({ id: 'folder-1', name: 'f' });
    mockRead.mockResolvedValue({
      config: {
        version: 1,
        updatedAtISO: '2026-01-05T00:00:00Z',
        jobs: [{
          id: 'alerts',
          type: 'alerts',
          enabled: true,
          schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
          params: { alertTypes: ['new_high_risks'], lookbackDays: 1, dueInDays: 7 },
        }],
      },
      fileId: 'cfg-1',
      webViewLink: undefined,
    });
    vi.mocked(runAlertsJob).mockResolvedValue({ noticeDriveFileId: 'n1', noticeDriveFileName: 'notice.md', counts: { new_high_risks: 1, new_open_loops_due_7d: 0, new_decisions: 0 } });

    const response = await POST(new Request('http://localhost/api/cron/run', { headers: { Authorization: 'Bearer secret' } }) as never);
    expect(response.status).toBe(200);
    expect(runAlertsJob).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ lookbackDays: 1 }),
    }));
  });
});
