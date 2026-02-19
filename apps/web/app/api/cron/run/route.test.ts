import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleServiceAuth', () => ({ getGoogleAccessTokenForCron: vi.fn() }));
vi.mock('../../../lib/googleDrive', () => ({ createDriveClient: vi.fn(() => ({})) }));
vi.mock('../../../lib/appDriveFolder', () => ({ resolveOrProvisionAppDriveFolder: vi.fn() }));
vi.mock('../../../lib/scheduler/scheduleConfigDrive', () => ({ readScheduleConfigFromDrive: vi.fn() }));
vi.mock('../../../lib/gmailSend', () => ({ sendEmail: vi.fn() }));
vi.mock('../../../lib/scheduler/emailNotifications', () => ({
  composeWeekInReviewEmail: vi.fn(() => ({ subject: 's', body: 'b' })),
  composeAlertsEmail: vi.fn(() => ({ subject: 's', body: 'b' })),
  shouldSendEmailMarkerExists: vi.fn(() => false),
  writeEmailSentMarker: vi.fn(),
}));
vi.mock('../../../lib/scheduler/runJobs', () => ({
  runWeekInReviewJob: vi.fn(),
  runAlertsJob: vi.fn(),
  appendJobRunLog: vi.fn(),
  saveNoticeToDrive: vi.fn(),
}));

import { resolveOrProvisionAppDriveFolder } from '../../../lib/appDriveFolder';
import { sendEmail } from '../../../lib/gmailSend';
import { getGoogleAccessTokenForCron } from '../../../lib/googleServiceAuth';
import {
  composeWeekInReviewEmail,
  shouldSendEmailMarkerExists,
} from '../../../lib/scheduler/emailNotifications';
import { appendJobRunLog, runAlertsJob, runWeekInReviewJob, saveNoticeToDrive } from '../../../lib/scheduler/runJobs';
import { readScheduleConfigFromDrive } from '../../../lib/scheduler/scheduleConfigDrive';
import { POST } from './route';

const mockAuth = vi.mocked(getGoogleAccessTokenForCron);
const mockFolder = vi.mocked(resolveOrProvisionAppDriveFolder);
const mockRead = vi.mocked(readScheduleConfigFromDrive);

describe('/api/cron/run', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret';
    process.env.GOOGLE_SERVICE_FROM_EMAIL = 'service@example.com';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T09:00:00Z'));
    vi.clearAllMocks();
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

  it('job with notify enabled triggers gmailSend once', async () => {
    mockAuth.mockResolvedValue({ ok: true, accessToken: 'token' });
    mockFolder.mockResolvedValue({ id: 'folder-1', name: 'f' });
    mockRead.mockResolvedValue({
      config: {
        version: 1,
        updatedAtISO: '2026-01-05T00:00:00Z',
        jobs: [{ id: 'week', type: 'week_in_review', enabled: true, schedule: { cron: '0 9 * * MON', timezone: 'UTC' }, notify: { enabled: true, to: ['to@example.com'] } }],
      },
      fileId: 'cfg-1',
      webViewLink: undefined,
    });
    vi.mocked(runWeekInReviewJob).mockResolvedValue({ reportDriveFileId: 'r1', reportDriveFileName: 'report.md', dateFromISO: '2026-01-01T00:00:00Z', dateToISO: '2026-01-08T00:00:00Z' });
    vi.mocked(saveNoticeToDrive).mockResolvedValue({ noticeDriveFileId: 'n1', noticeDriveFileName: 'notice.md' });
    vi.mocked(sendEmail).mockResolvedValue({ id: 'msg-1' });

    const response = await POST(new Request('http://localhost/api/cron/run', { headers: { Authorization: 'Bearer secret' } }) as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(appendJobRunLog).toHaveBeenCalled();
    expect(json.ranJobs[0].email).toMatchObject({ attempted: true, ok: true });
  });

  it('marker exists -> skipped', async () => {
    mockAuth.mockResolvedValue({ ok: true, accessToken: 'token' });
    mockFolder.mockResolvedValue({ id: 'folder-1', name: 'f' });
    mockRead.mockResolvedValue({
      config: {
        version: 1,
        updatedAtISO: '2026-01-05T00:00:00Z',
        jobs: [{ id: 'week', type: 'week_in_review', enabled: true, schedule: { cron: '0 9 * * MON', timezone: 'UTC' }, notify: { enabled: true, to: ['to@example.com'] } }],
      },
      fileId: 'cfg-1',
      webViewLink: undefined,
    });
    vi.mocked(runWeekInReviewJob).mockResolvedValue({ reportDriveFileId: 'r1', reportDriveFileName: 'report.md', dateFromISO: '2026-01-01T00:00:00Z', dateToISO: '2026-01-08T00:00:00Z' });
    vi.mocked(saveNoticeToDrive).mockResolvedValue({ noticeDriveFileId: 'n1', noticeDriveFileName: 'notice.md' });
    vi.mocked(shouldSendEmailMarkerExists).mockResolvedValue(true);

    const response = await POST(new Request('http://localhost/api/cron/run', { headers: { Authorization: 'Bearer secret' } }) as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(json.ranJobs[0].email).toMatchObject({ skipped: true });
  });

  it('send failure -> job ok but email error recorded', async () => {
    mockAuth.mockResolvedValue({ ok: true, accessToken: 'token' });
    mockFolder.mockResolvedValue({ id: 'folder-1', name: 'f' });
    mockRead.mockResolvedValue({
      config: {
        version: 1,
        updatedAtISO: '2026-01-05T00:00:00Z',
        jobs: [{ id: 'week', type: 'week_in_review', enabled: true, schedule: { cron: '0 9 * * MON', timezone: 'UTC' }, notify: { enabled: true, to: ['to@example.com'] } }],
      },
      fileId: 'cfg-1',
      webViewLink: undefined,
    });
    vi.mocked(runWeekInReviewJob).mockResolvedValue({ reportDriveFileId: 'r1', reportDriveFileName: 'report.md', dateFromISO: '2026-01-01T00:00:00Z', dateToISO: '2026-01-08T00:00:00Z' });
    vi.mocked(saveNoticeToDrive).mockResolvedValue({ noticeDriveFileId: 'n1', noticeDriveFileName: 'notice.md' });
    vi.mocked(shouldSendEmailMarkerExists).mockResolvedValue(false);
    vi.mocked(sendEmail).mockRejectedValue(new Error('bad token'));

    const response = await POST(new Request('http://localhost/api/cron/run', { headers: { Authorization: 'Bearer secret' } }) as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ranJobs[0].ok).toBe(true);
    expect(json.ranJobs[0].email).toMatchObject({ attempted: true, ok: false, error: 'bad token' });
    expect(composeWeekInReviewEmail).toHaveBeenCalled();
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
    vi.mocked(runAlertsJob).mockResolvedValue({ noticeDriveFileId: 'n1', noticeDriveFileName: 'notice.md', counts: { new_high_risks: 1, new_open_loops_due_7d: 0, new_decisions: 0 }, lookbackStartISO: '2026-01-04T09:00:00Z', nowISO: '2026-01-05T09:00:00Z' });

    const response = await POST(new Request('http://localhost/api/cron/run', { headers: { Authorization: 'Bearer secret' } }) as never);
    expect(response.status).toBe(200);
    expect(runAlertsJob).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ lookbackDays: 1 }),
    }));
  });
});
