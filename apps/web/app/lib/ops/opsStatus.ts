import { ScheduleConfigSchema } from '@timeline/shared';
import type { drive_v3 } from 'googleapis';

import { readScheduleConfigFromDrive } from '../scheduler/scheduleConfigDrive';
import { readCronLock } from '../scheduler/cronLock';
import { resolveGenericWebhookUrl, resolveSlackWebhookUrl } from '../secrets/webhookTargets';
import { OpsStatusSchema, type OpsStatus } from './schemas';

const parseJsonLines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
  try {
    return [JSON.parse(line) as Record<string, any>];
  } catch {
    return [];
  }
});

const readJobRunLines = async (drive: drive_v3.Drive, folderId: string, limit = 500) => {
  const listed = await drive.files.list({ q: `'${folderId}' in parents and trashed=false and name='job_runs.jsonl'`, pageSize: 1, fields: 'files(id)' });
  const fileId = listed.data.files?.[0]?.id;
  if (!fileId) return [] as Array<Record<string, any>>;
  const data = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const all = parseJsonLines(typeof data.data === 'string' ? data.data : '');
  return all.slice(-limit);
};

export const readOpsStatus = async ({ drive, driveFolderId }: { drive: drive_v3.Drive; driveFolderId: string }): Promise<OpsStatus> => {
  const loaded = await readScheduleConfigFromDrive(drive, driveFolderId);
  const config = ScheduleConfigSchema.parse(loaded.config);
  const logs = await readJobRunLines(drive, driveFolderId);
  const lock = await readCronLock({ drive, driveFolderId }).catch(() => null);

  const missingEnvTargets = { slack: [] as string[], webhook: [] as string[] };
  for (const job of config.jobs) {
    const channels = job.notify?.channels;
    const slackKeys = [
      ...(channels?.slack?.targets ?? []),
      ...((channels?.slack?.routesTargets ?? []).flatMap((r) => r.targets)),
    ];
    for (const key of new Set(slackKeys.map((k) => k.trim().toUpperCase()).filter(Boolean))) {
      if (!resolveSlackWebhookUrl(key)) missingEnvTargets.slack.push(key);
    }
    const webhookKeys = [
      ...(channels?.webhook?.targets ?? []),
      ...((channels?.webhook?.routesTargets ?? []).flatMap((r) => r.targets)),
    ];
    for (const key of new Set(webhookKeys.map((k) => k.trim().toUpperCase()).filter(Boolean))) {
      if (!resolveGenericWebhookUrl(key)) missingEnvTargets.webhook.push(key);
    }
  }

  const uniqueMissing = {
    slack: Array.from(new Set(missingEnvTargets.slack)),
    webhook: Array.from(new Set(missingEnvTargets.webhook)),
  };

  const recentFailures = logs.flatMap((row) => (row.failures ?? []) as Array<Record<string, any>>).slice(-50);
  const missingRefreshToken = logs.some((row) => row.error === 'missing_refresh_token' || (row.failures ?? []).some((f: any) => f.code === 'missing_refresh_token'));
  const insufficientScope = logs.some((row) => (row.failures ?? []).some((f: any) => f.code === 'insufficient_scope' || String(f.message ?? '').includes('insufficient_scope')));

  const jobs = config.jobs.map((job) => {
    const latest = [...logs].reverse().find((row) => row.jobId === job.id);
    const jobFailures = recentFailures.filter((f) => f.jobId === job.id);
    const issues = [
      ...(uniqueMissing.slack.length || uniqueMissing.webhook.length ? ['missing_env_targets' as const] : []),
      ...(missingRefreshToken ? ['missing_refresh_token' as const] : []),
      ...(insufficientScope ? ['insufficient_scope' as const] : []),
      ...(jobFailures.length ? ['recent_failures' as const] : []),
    ];

    return {
      jobId: job.id,
      type: job.type,
      enabled: job.enabled,
      schedule: job.schedule,
      ...(latest ? {
        lastRun: { tsISO: latest.tsISO, ok: Boolean(latest.ok), durationMs: latest.durationMs },
        lastNotification: {
          email: {
            sent: latest.email?.emailedRoutesSent ?? (latest.email?.ok ? 1 : 0),
            failed: latest.email?.emailedRoutesFailed ?? (latest.email?.ok === false ? 1 : 0),
            skipped: latest.email?.emailedRoutesSkipped ?? (latest.email?.skipped ? 1 : 0),
            attemptsTotal: latest.email?.emailAttemptsTotal,
          },
          slack: {
            sent: latest.email?.slackSent,
            failed: latest.email?.slackFailed,
            skipped: latest.email?.slackSkipped,
            attemptsTotal: latest.email?.slackAttemptsTotal,
          },
          webhook: {
            sent: latest.email?.webhookSent,
            failed: latest.email?.webhookFailed,
            skipped: latest.email?.webhookSkipped,
            attemptsTotal: latest.email?.webhookAttemptsTotal,
          },
          perProfileReports: {
            saved: latest.email?.perRouteReportsSaved,
            reused: latest.email?.perRouteReportsReused,
            skipped: latest.email?.perRouteReportsSkipped,
            failed: latest.email?.perRouteReportsFailed,
          },
        },
      } : {}),
      ...(issues.length ? { issues } : {}),
    };
  });

  const status = {
    ok: true as const,
    generatedAtISO: new Date().toISOString(),
    scheduler: {
      lock: {
        held: Boolean(lock?.leaseUntilISO && Date.parse(lock.leaseUntilISO) > Date.now()),
        leaseUntilISO: lock?.leaseUntilISO,
      },
      lastCronRunISO: logs[logs.length - 1]?.tsISO,
    },
    jobs,
    issues: {
      missingEnvTargets: uniqueMissing,
      auth: {
        missingRefreshToken,
        insufficientScope,
        notes: [
          ...(missingRefreshToken ? ['Cron could not find a refresh token.'] : []),
          ...(insufficientScope ? ['Google returned insufficient scope for one or more requests.'] : []),
        ],
      },
      recentFailures: recentFailures.slice(-50).map((f) => ({
        tsISO: String(f.tsISO ?? ''),
        jobId: String(f.jobId ?? ''),
        type: String(f.type ?? 'error'),
        channel: f.channel ? String(f.channel) : undefined,
        targetKey: f.targetKey ? String(f.targetKey) : undefined,
        status: typeof f.status === 'number' ? f.status : undefined,
        code: f.code ? String(f.code) : undefined,
        message: f.message ? String(f.message).slice(0, 200) : undefined,
      })),
    },
  };

  return OpsStatusSchema.parse(status);
};
