import { NextResponse, type NextRequest } from 'next/server';

import { getAdminEmailList } from '../../../lib/adminAuth';
import { resolveOrProvisionAppDriveFolder } from '../../../lib/appDriveFolder';
import { readEntityAliasesFromDrive } from '../../../lib/entities/aliases';
import { sendEmail } from '../../../lib/gmailSend';
import { createDriveClient } from '../../../lib/googleDrive';
import { getGoogleAccessTokenForCron } from '../../../lib/googleServiceAuth';
import {
  composeAlertsEmail,
  composeWeekInReviewEmail,
  shouldSendEmailMarkerExists,
  writeEmailSentMarker,
} from '../../../lib/scheduler/emailNotifications';
import { buildPersonalizedDigest, normalizeProfileFilters } from '../../../lib/scheduler/personalizeDigest';
import { maybeGeneratePerProfileReport, resetPerProfileReportCounter } from '../../../lib/scheduler/perProfileReports';
import {
  appendJobRunLog,
  runAlertsJob,
  runWeekInReviewJob,
  saveNoticeToDrive,
} from '../../../lib/scheduler/runJobs';
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
  const aliases = await readEntityAliasesFromDrive(drive, folder.id);
  const now = new Date();
  const fromEmail = process.env.GOOGLE_SERVICE_FROM_EMAIL ?? getAdminEmailList()[0] ?? 'me';
  const ranJobs: Array<{
    jobId: string;
    type: string;
    ok: boolean;
    output?: unknown;
    error?: string;
    email?: {
      attempted: boolean;
      ok?: boolean;
      skipped?: boolean;
      error?: string;
      mode?: 'broadcast' | 'routes';
      profileId?: string;
      emailedRoutesAttempted?: number;
      emailedRoutesSent?: number;
      emailedRoutesSkipped?: number;
      emailedRoutesFailed?: number;
      perRouteReportsAttempted?: number;
      perRouteReportsSaved?: number;
      perRouteReportsReused?: number;
      perRouteReportsSkipped?: number;
      perRouteReportsFailed?: number;
      routeReports?: Array<{ profileId: string; reportSaved: boolean; reportReused: boolean; reportSkippedReason?: string }>;
    };
  }> = [];

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

        const result: (typeof ranJobs)[number] = { jobId: job.id, type: job.type, ok: true, output: { ...output, ...notice } };

        if (job.notify?.enabled) {
          const runKey = `${job.id}:${output.dateFromISO}:${output.dateToISO}`;
          if ((job.notify.mode ?? 'broadcast') === 'routes') {
            let attempted = 0;
            let sent = 0;
            let skipped = 0;
            let failed = 0;
            let perRouteReportsAttempted = 0;
            let perRouteReportsSaved = 0;
            let perRouteReportsReused = 0;
            let perRouteReportsSkipped = 0;
            let perRouteReportsFailed = 0;
            const routeReports: Array<{ profileId: string; reportSaved: boolean; reportReused: boolean; reportSkippedReason?: string }> = [];
            const profiles = new Map((loaded.config.recipientProfiles ?? []).map((profile) => [profile.id, profile]));
            resetPerProfileReportCounter(runKey);
            for (const route of job.notify.routes ?? []) {
              const profile = profiles.get(route.profileId);
              if (!profile) {
                failed += 1;
                continue;
              }
              const effectiveProfile = {
                ...profile,
                filters: normalizeProfileFilters({ ...profile.filters, ...(route.filtersOverride ?? {}) }, aliases.aliases),
              };
              const digest = await buildPersonalizedDigest({
                jobType: 'week_in_review',
                profile: effectiveProfile,
                jobOutput: { ...output, ...notice },
                drive,
                driveFolderId: folder.id,
                accessToken: auth.accessToken,
                now,
                aliasMap: aliases.aliases,
              });
              attempted += 1;
              if (digest.empty && !job.notify.sendWhenEmpty) {
                skipped += 1;
                routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: false, reportSkippedReason: 'digest_empty' });
                continue;
              }

              const report = job.notify.generatePerRouteReport
                ? await maybeGeneratePerProfileReport({
                enabled: job.notify.generatePerRouteReport,
                reportTitleTemplate: job.notify.reportTitleTemplate,
                maxPerRouteReportsPerRun: job.notify.maxPerRouteReportsPerRun,
                jobType: 'week_in_review',
                jobId: job.id,
                runKey,
                profile: effectiveProfile,
                dateWindow: { dateFromISO: output.dateFromISO, dateToISO: output.dateToISO },
                drive,
                driveFolderId: folder.id,
              })
                : { skipped: true as const, reason: 'disabled' as const };
              if (job.notify.generatePerRouteReport) perRouteReportsAttempted += 1;
              if (job.notify.generatePerRouteReport) {
                if (report.error) {
                  perRouteReportsFailed += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: false, reportSkippedReason: report.error });
                } else if (report.reused) {
                  perRouteReportsReused += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: true });
                } else if (report.report) {
                  perRouteReportsSaved += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: true, reportReused: false });
                } else {
                  perRouteReportsSkipped += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: false, reportSkippedReason: report.reason ?? 'skipped' });
                }
              }

              const recipientKey = profile.id;
              if (await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey })) {
                skipped += 1;
                continue;
              }

              try {
                const sentMessage = await sendEmail({
                  accessToken: auth.accessToken,
                  fromEmail,
                  to: profile.to,
                  cc: profile.cc,
                  subject: `${route.subjectPrefix?.trim() ?? ''}${route.subjectPrefix ? ' ' : ''}${digest.subject}`,
                  textBody: (await buildPersonalizedDigest({
                    jobType: 'week_in_review',
                    profile: effectiveProfile,
                    jobOutput: { ...output, ...notice, ...(report.report ? { perProfileReportDriveFileId: report.report.driveFileId } : {}) },
                    drive,
                    driveFolderId: folder.id,
                    accessToken: auth.accessToken,
                    now,
                    aliasMap: aliases.aliases,
                  })).body,
                });
                await writeEmailSentMarker({
                  drive,
                  folderId: folder.id,
                  runKey,
                  recipientKey,
                  details: { runKey, recipientKey, sentAtISO: now.toISOString(), gmailMessageId: sentMessage.id },
                });
                sent += 1;
              } catch {
                failed += 1;
              }
            }
            result.email = {
              attempted: attempted > 0,
              mode: 'routes',
              emailedRoutesAttempted: attempted,
              emailedRoutesSent: sent,
              emailedRoutesSkipped: skipped,
              emailedRoutesFailed: failed,
              perRouteReportsAttempted,
              perRouteReportsSaved,
              perRouteReportsReused,
              perRouteReportsSkipped,
              perRouteReportsFailed,
              routeReports,
            };
          } else {
            const markerExists = await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey: 'broadcast' });
            if (markerExists) {
              result.email = { attempted: false, skipped: true, mode: 'broadcast' };
            } else {
              try {
                const message = composeWeekInReviewEmail({
                  job,
                  runOutput: { ...output, ...notice },
                  now,
                  driveFolderId: folder.id,
                });
                const sent = await sendEmail({
                  accessToken: auth.accessToken,
                  fromEmail,
                  to: job.notify.to ?? [],
                  cc: job.notify.cc,
                  subject: message.subject,
                  textBody: message.body,
                });
                result.email = { attempted: true, ok: true, mode: 'broadcast' };
                await writeEmailSentMarker({
                  drive,
                  folderId: folder.id,
                  runKey,
                  recipientKey: 'broadcast',
                  details: {
                    runKey,
                    sentAtISO: now.toISOString(),
                    subject: message.subject,
                    gmailMessageId: sent.id,
                  },
                });
              } catch (emailError) {
                result.email = {
                  attempted: true,
                  ok: false,
                  mode: 'broadcast',
                  error: emailError instanceof Error ? emailError.message : 'email_send_failed',
                };
              }
            }
          }
        }
        ranJobs.push(result);
      } else {
        const output = await runAlertsJob({ drive, params: job.params, now, driveFolderId: folder.id, timezone: job.schedule.timezone });
        const result: (typeof ranJobs)[number] = { jobId: job.id, type: job.type, ok: true, output };

        if (job.notify?.enabled) {
          const runKey = `${job.id}:${output.lookbackStartISO}:${output.nowISO}`;
          if ((job.notify.mode ?? 'broadcast') === 'routes') {
            let attempted = 0;
            let sent = 0;
            let skipped = 0;
            let failed = 0;
            let perRouteReportsAttempted = 0;
            let perRouteReportsSaved = 0;
            let perRouteReportsReused = 0;
            let perRouteReportsSkipped = 0;
            let perRouteReportsFailed = 0;
            const routeReports: Array<{ profileId: string; reportSaved: boolean; reportReused: boolean; reportSkippedReason?: string }> = [];
            const profiles = new Map((loaded.config.recipientProfiles ?? []).map((profile) => [profile.id, profile]));
            resetPerProfileReportCounter(runKey);
            for (const route of job.notify.routes ?? []) {
              const profile = profiles.get(route.profileId);
              if (!profile) {
                failed += 1;
                continue;
              }
              const effectiveProfile = {
                ...profile,
                filters: normalizeProfileFilters({ ...profile.filters, ...(route.filtersOverride ?? {}) }, aliases.aliases),
              };
              const digest = await buildPersonalizedDigest({
                jobType: 'alerts',
                profile: effectiveProfile,
                jobOutput: output,
                drive,
                driveFolderId: folder.id,
                accessToken: auth.accessToken,
                now,
                aliasMap: aliases.aliases,
              });
              attempted += 1;
              if (digest.empty && !job.notify.sendWhenEmpty) {
                skipped += 1;
                routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: false, reportSkippedReason: 'digest_empty' });
                continue;
              }

              const report = job.notify.generatePerRouteReport
                ? await maybeGeneratePerProfileReport({
                enabled: job.notify.generatePerRouteReport,
                reportTitleTemplate: job.notify.reportTitleTemplate,
                maxPerRouteReportsPerRun: job.notify.maxPerRouteReportsPerRun,
                jobType: 'alerts',
                jobId: job.id,
                runKey,
                profile: effectiveProfile,
                dateWindow: { dateFromISO: output.lookbackStartISO, dateToISO: output.nowISO },
                drive,
                driveFolderId: folder.id,
              })
                : { skipped: true as const, reason: 'disabled' as const };
              if (job.notify.generatePerRouteReport) perRouteReportsAttempted += 1;
              if (job.notify.generatePerRouteReport) {
                if (report.error) {
                  perRouteReportsFailed += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: false, reportSkippedReason: report.error });
                } else if (report.reused) {
                  perRouteReportsReused += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: true });
                } else if (report.report) {
                  perRouteReportsSaved += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: true, reportReused: false });
                } else {
                  perRouteReportsSkipped += 1;
                  routeReports.push({ profileId: profile.id, reportSaved: false, reportReused: false, reportSkippedReason: report.reason ?? 'skipped' });
                }
              }

              const recipientKey = profile.id;
              if (await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey })) {
                skipped += 1;
                continue;
              }

              try {
                const sentMessage = await sendEmail({
                  accessToken: auth.accessToken,
                  fromEmail,
                  to: profile.to,
                  cc: profile.cc,
                  subject: `${route.subjectPrefix?.trim() ?? ''}${route.subjectPrefix ? ' ' : ''}${digest.subject}`,
                  textBody: (await buildPersonalizedDigest({
                    jobType: 'alerts',
                    profile: effectiveProfile,
                    jobOutput: { ...output, ...(report.report ? { perProfileReportDriveFileId: report.report.driveFileId } : {}) },
                    drive,
                    driveFolderId: folder.id,
                    accessToken: auth.accessToken,
                    now,
                    aliasMap: aliases.aliases,
                  })).body,
                });
                await writeEmailSentMarker({
                  drive,
                  folderId: folder.id,
                  runKey,
                  recipientKey,
                  details: { runKey, recipientKey, sentAtISO: now.toISOString(), gmailMessageId: sentMessage.id },
                });
                sent += 1;
              } catch {
                failed += 1;
              }
            }
            result.email = {
              attempted: attempted > 0,
              mode: 'routes',
              emailedRoutesAttempted: attempted,
              emailedRoutesSent: sent,
              emailedRoutesSkipped: skipped,
              emailedRoutesFailed: failed,
              perRouteReportsAttempted,
              perRouteReportsSaved,
              perRouteReportsReused,
              perRouteReportsSkipped,
              perRouteReportsFailed,
              routeReports,
            };
          } else {
            const markerExists = await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey: 'broadcast' });
            if (markerExists) {
              result.email = { attempted: false, skipped: true, mode: 'broadcast' };
            } else {
              try {
                const message = composeAlertsEmail({
                  job,
                  runOutput: output,
                  now,
                  driveFolderId: folder.id,
                });
                const sent = await sendEmail({
                  accessToken: auth.accessToken,
                  fromEmail,
                  to: job.notify.to ?? [],
                  cc: job.notify.cc,
                  subject: message.subject,
                  textBody: message.body,
                });
                result.email = { attempted: true, ok: true, mode: 'broadcast' };
                await writeEmailSentMarker({
                  drive,
                  folderId: folder.id,
                  runKey,
                  recipientKey: 'broadcast',
                  details: {
                    runKey,
                    sentAtISO: now.toISOString(),
                    subject: message.subject,
                    gmailMessageId: sent.id,
                  },
                });
              } catch (emailError) {
                result.email = {
                  attempted: true,
                  ok: false,
                  mode: 'broadcast',
                  error: emailError instanceof Error ? emailError.message : 'email_send_failed',
                };
              }
            }
          }
        }

        ranJobs.push(result);
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
        email: ranJobs[ranJobs.length - 1]?.email,
        durationMs: Date.now() - started,
      },
    });
  }

  return NextResponse.json({ ok: true, ranJobs });
};

export const POST = run;
export const GET = run;
