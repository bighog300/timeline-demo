import { describe, expect, it } from 'vitest';

import {
  composeAlertsEmail,
  composeWeekInReviewEmail,
  emailMarkerName,
  shouldSendEmailMarkerExists,
} from './emailNotifications';

describe('emailNotifications', () => {
  it('applies subjectPrefix and includes report link for week in review', () => {
    const message = composeWeekInReviewEmail({
      job: { id: 'weekly', notify: { subjectPrefix: '[Timeline]' } },
      runOutput: {
        dateFromISO: '2026-01-01T00:00:00Z',
        dateToISO: '2026-01-08T00:00:00Z',
        reportDriveFileId: 'file-123',
        totals: { decisionsMatched: 2, openLoopsMatched: 1, risksMatched: 1, artifactsMatched: 9 },
      },
      now: new Date('2026-01-08T00:00:00Z'),
      driveFolderId: 'folder',
    });

    expect(message.subject.startsWith('[Timeline]')).toBe(true);
    expect(message.body).toContain('https://drive.google.com/file/d/file-123/view');
  });

  it('composes alerts message with top counts', () => {
    const message = composeAlertsEmail({
      job: { id: 'alerts' },
      runOutput: {
        counts: { new_high_risks: 1, new_open_loops_due_7d: 3, new_decisions: 2 },
        noticeDriveFileId: 'notice-1',
        lookbackStartISO: '2026-01-07T00:00:00Z',
        nowISO: '2026-01-08T00:00:00Z',
      },
      now: new Date('2026-01-08T00:00:00Z'),
      driveFolderId: 'folder',
    });

    expect(message.body).toContain('New high risks: 1');
    expect(message.body).toContain('https://drive.google.com/file/d/notice-1/view');
  });

  it('uses per-recipient marker name format', () => {
    expect(emailMarkerName('job:window', 'p1')).toContain('__p1');
  });

  it('checks legacy broadcast marker compatibility', async () => {
    const drive = {
      files: {
        list: async ({ q }: { q: string }) => ({ data: { files: q.includes('or name') ? [{ id: 'f1' }] : [] } }),
      },
    };

    await expect(
      shouldSendEmailMarkerExists({ drive: drive as never, folderId: 'folder', runKey: 'rk', recipientKey: 'broadcast' }),
    ).resolves.toBe(true);
  });
});
