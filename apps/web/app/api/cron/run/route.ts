import { NextResponse, type NextRequest } from 'next/server';

import { resolveOrProvisionAppDriveFolder } from '../../../lib/appDriveFolder';
import { createDriveClient } from '../../../lib/googleDrive';
import { getGoogleAccessTokenForCron } from '../../../lib/googleServiceAuth';
import { appendJobRunLog, runAlertsJob, runWeekInReviewJob, saveNoticeToDrive } from '../../../lib/scheduler/runJobs';
import { readScheduleConfigFromDrive } from '../../../lib/scheduler/scheduleConfigDrive';

const isAuthorized = (request: NextRequest) => {
  const header = request.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && header === `Bearer ${expected}`);
};

const dowValue = (token: string): number | null => {
  const normalized = token.trim().toUpperCase();
  if (/^\d+$/.test(normalized)) {
    const value = Number(normalized);
    if (value >= 0 && value <= 7) return value % 7;
  }
  const names: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  return names[normalized] ?? null;
};

const fieldMatches = (field: string, value: number, mapper?: (token: string) => number | null) => {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = Number(field.slice(2));
    return Number.isFinite(step) && step > 0 ? value % step === 0 : false;
  }

  return field.split(',').some((token) => {
    const mapped = mapper ? mapper(token) : Number(token);
    return Number.isFinite(mapped) && mapped === value;
  });
};

const isJobDue = (cron: string, _timezone: string, now: Date) => {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    fieldMatches(minute, now.getUTCMinutes())
    && fieldMatches(hour, now.getUTCHours())
    && fieldMatches(dayOfMonth, now.getUTCDate())
    && fieldMatches(month, now.getUTCMonth() + 1)
    && fieldMatches(dayOfWeek, now.getUTCDay(), dowValue)
  );
};

const run = async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const auth = await getGoogleAccessTokenForCron();
  if (!auth.ok) {
    return NextResponse.json({ ok: true, ranJobs: [{ jobId: 'auth', type: 'auth', ok: false, error: auth.error }] });
  }

  const drive = createDriveClient(auth.accessToken);
  const folder = await resolveOrProvisionAppDriveFolder(drive, { requestId: 'cron', route: '/api/cron/run' });
  if (!folder?.id) {
    return NextResponse.json({ ok: false, error: 'drive_not_provisioned' }, { status: 500 });
  }

  const loaded = await readScheduleConfigFromDrive(drive, folder.id);
  const now = new Date();
  const ranJobs: Array<{ jobId: string; type: string; ok: boolean; output?: unknown; error?: string }> = [];

  for (const job of loaded.config.jobs.filter((item) => item.enabled)) {
    if (!isJobDue(job.schedule.cron, job.schedule.timezone, now)) {
      continue;
    }

    const started = Date.now();
    try {
      if (job.type === 'week_in_review') {
        const output = await runWeekInReviewJob({ drive, params: job.params, now, driveFolderId: folder.id });
        const notice = await saveNoticeToDrive({
          drive,
          folderId: folder.id,
          jobId: job.id,
          now,
          markdown: `# Week in Review\n\nJob ${job.id} completed.\n\n- Report file: ${output.reportDriveFileName ?? 'not exported'}\n`,
        });
        ranJobs.push({ jobId: job.id, type: job.type, ok: true, output: { ...output, ...notice } });
      } else {
        const output = await runAlertsJob({ drive, params: job.params, now, driveFolderId: folder.id, timezone: job.schedule.timezone });
        ranJobs.push({ jobId: job.id, type: job.type, ok: true, output });
      }
    } catch (error) {
      ranJobs.push({ jobId: job.id, type: job.type, ok: false, error: error instanceof Error ? error.message : 'job_failed' });
    }

    await appendJobRunLog({
      drive,
      folderId: folder.id,
      record: {
        tsISO: now.toISOString(),
        jobId: job.id,
        type: job.type,
        ok: ranJobs[ranJobs.length - 1]?.ok ?? false,
        durationMs: Date.now() - started,
      },
    });
  }

  return NextResponse.json({ ok: true, ranJobs });
};

export const POST = run;
export const GET = run;
