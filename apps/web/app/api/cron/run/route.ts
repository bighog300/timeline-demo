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
import { resolveGenericWebhookUrl, resolveSlackWebhookUrl } from '../../../lib/secrets/webhookTargets';
import { formatDigest } from '../../../lib/notifications/formatDigest';
import { getCircuitState, loadCircuitBreakers, recordSendFailure, recordSendSuccess, saveCircuitBreakers } from '../../../lib/notifications/circuitBreaker';
import { postSlackMessage } from '../../../lib/notifications/slack';
import { postWebhook } from '../../../lib/notifications/webhook';
import { existsMarker, writeMarker } from '../../../lib/scheduler/channelMarkers';
import { releaseCronLock, tryAcquireCronLock } from '../../../lib/scheduler/cronLock';

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



const parseTargets = (value: string[] | undefined) => (value ?? []).map((item) => item.trim().toUpperCase()).filter(Boolean);

const resolveRouteTargets = ({
  recipientKey,
  mode,
  defaults,
  overrides,
}: {
  recipientKey: string;
  mode: 'broadcast' | 'routes';
  defaults?: string[];
  overrides?: Array<{ profileId: string; targets: string[] }>;
}) => {
  if (mode === 'broadcast') return parseTargets(defaults);
  const override = overrides?.find((item) => item.profileId === recipientKey)?.targets;
  return parseTargets(override ?? defaults);
};

const sendChannelNotifications = async ({
  drive,
  folderId,
  notify,
  mode,
  runKey,
  recipientKey,
  profileName,
  digest,
  jobMeta,
  now,
  breakerState,
}: {
  drive: Parameters<typeof existsMarker>[0]['drive'];
  folderId: string;
  notify: Record<string, any>;
  mode: 'broadcast' | 'routes';
  runKey: string;
  recipientKey: string;
  profileName?: string;
  digest: Awaited<ReturnType<typeof buildPersonalizedDigest>>;
  jobMeta: { id: string; type: 'week_in_review' | 'alerts'; dateFromISO?: string; dateToISO?: string; lookbackStartISO?: string; nowISO?: string };
  now: Date;
  breakerState: Awaited<ReturnType<typeof loadCircuitBreakers>>;
}) => {
  const slack = { attempted: 0, sent: 0, skipped: 0, failed: 0, attemptsTotal: 0, retries: 0, missingTargets: [] as string[] };
  const webhook = { attempted: 0, sent: 0, skipped: 0, failed: 0, attemptsTotal: 0, retries: 0, missingTargets: [] as string[] };
  const failures: Array<{ channel: 'slack' | 'webhook'; targetKey: string; status?: number; code?: string; message: string }> = [];

  const slackChannel = notify.channels?.slack;
  if (slackChannel?.enabled) {
    const slackTargets = resolveRouteTargets({
      recipientKey,
      mode,
      defaults: slackChannel.targets,
      overrides: slackChannel.routesTargets,
    });

    for (const targetKey of slackTargets) {
      slack.attempted += 1;
      const muted = getCircuitState(breakerState, { channel: 'slack', targetKey }, now);
      if (muted.muted) {
        slack.skipped += 1;
        failures.push({ channel: 'slack', targetKey, code: 'skipped_muted', message: `muted_until:${muted.mutedUntilISO ?? 'unknown'}` });
        continue;
      }
      const webhookUrl = resolveSlackWebhookUrl(targetKey);
      if (!webhookUrl) {
        slack.failed += 1;
        slack.missingTargets.push(targetKey);
        failures.push({ channel: 'slack', targetKey, code: 'missing_env_target', message: 'missing_env_target' });
        recordSendFailure({ state: breakerState, target: { channel: 'slack', targetKey }, error: { code: 'missing_env_target', message: 'missing_env_target' }, now });
        continue;
      }
      if (await existsMarker({ drive, folderId, type: 'slack', runKey, recipientKey, targetKey })) {
        slack.skipped += 1;
        continue;
      }
      try {
        const formatted = formatDigest({
          digest,
          job: { ...jobMeta, runKey },
          recipient: { key: recipientKey, ...(profileName ? { profileName } : {}) },
          maxItems: slackChannel.maxItems ?? 8,
          includeReportLink: slackChannel.includeReportLink ?? true,
        });
        const slackResult = await postSlackMessage({ webhookUrl, text: formatted.slackText });
        slack.attemptsTotal += slackResult.attempts;
        slack.retries += Math.max(0, slackResult.attempts - 1);
        await writeMarker({
          drive, folderId, type: 'slack', runKey, recipientKey, targetKey,
          details: { runKey, recipientKey, targetKey, sentAtISO: now.toISOString() },
        });
        slack.sent += 1;
        recordSendSuccess({ state: breakerState, target: { channel: 'slack', targetKey } });
      } catch (error) {
        slack.failed += 1;
        const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: number }).status) : undefined;
        const attempts = error && typeof error === 'object' && 'attempts' in error ? Number((error as { attempts?: number }).attempts) : 1;
        slack.attemptsTotal += Number.isFinite(attempts) ? attempts : 1;
        slack.retries += Math.max(0, (Number.isFinite(attempts) ? attempts : 1) - 1);
        const message = error instanceof Error ? error.message.slice(0, 200) : 'slack_send_failed';
        failures.push({ channel: 'slack', targetKey, status, message });
        recordSendFailure({ state: breakerState, target: { channel: 'slack', targetKey }, error: { status, message }, now });
      }
    }
  }

  const webhookChannel = notify.channels?.webhook;
  if (webhookChannel?.enabled) {
    const webhookTargets = resolveRouteTargets({
      recipientKey,
      mode,
      defaults: webhookChannel.targets,
      overrides: webhookChannel.routesTargets,
    });
    for (const targetKey of webhookTargets) {
      webhook.attempted += 1;
      const muted = getCircuitState(breakerState, { channel: 'webhook', targetKey }, now);
      if (muted.muted) {
        webhook.skipped += 1;
        failures.push({ channel: 'webhook', targetKey, code: 'skipped_muted', message: `muted_until:${muted.mutedUntilISO ?? 'unknown'}` });
        continue;
      }
      const url = resolveGenericWebhookUrl(targetKey);
      if (!url) {
        webhook.failed += 1;
        webhook.missingTargets.push(targetKey);
        failures.push({ channel: 'webhook', targetKey, code: 'missing_env_target', message: 'missing_env_target' });
        recordSendFailure({ state: breakerState, target: { channel: 'webhook', targetKey }, error: { code: 'missing_env_target', message: 'missing_env_target' }, now });
        continue;
      }
      if (await existsMarker({ drive, folderId, type: 'webhook', runKey, recipientKey, targetKey })) {
        webhook.skipped += 1;
        continue;
      }
      try {
        const formatted = formatDigest({
          digest,
          job: { ...jobMeta, runKey },
          recipient: { key: recipientKey, ...(profileName ? { profileName } : {}) },
          maxItems: webhookChannel.maxItems ?? 10,
          includeReportLink: webhookChannel.includeReportLink ?? true,
        });
        const webhookResult = await postWebhook({ url, payload: formatted.webhookPayload });
        webhook.attemptsTotal += webhookResult.attempts;
        webhook.retries += Math.max(0, webhookResult.attempts - 1);
        await writeMarker({
          drive, folderId, type: 'webhook', runKey, recipientKey, targetKey,
          details: { runKey, recipientKey, targetKey, sentAtISO: now.toISOString(), version: 1 },
        });
        webhook.sent += 1;
        recordSendSuccess({ state: breakerState, target: { channel: 'webhook', targetKey } });
      } catch (error) {
        webhook.failed += 1;
        const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: number }).status) : undefined;
        const attempts = error && typeof error === 'object' && 'attempts' in error ? Number((error as { attempts?: number }).attempts) : 1;
        webhook.attemptsTotal += Number.isFinite(attempts) ? attempts : 1;
        webhook.retries += Math.max(0, (Number.isFinite(attempts) ? attempts : 1) - 1);
        const message = error instanceof Error ? error.message.slice(0, 200) : 'webhook_send_failed';
        failures.push({ channel: 'webhook', targetKey, status, message });
        recordSendFailure({ state: breakerState, target: { channel: 'webhook', targetKey }, error: { status, message }, now });
      }
    }
  }

  return { slack, webhook, failures };
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

  const lockHolder = `cron-${Math.random().toString(36).slice(2, 10)}`;
  const lock = await tryAcquireCronLock({ drive, driveFolderId: folder.id, holder: lockHolder });
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'locked' });
  }

  const loaded = await readScheduleConfigFromDrive(drive, folder.id);
  const breakerState = await loadCircuitBreakers(drive, folder.id);
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
      slackAttempted?: number;
      slackSent?: number;
      slackSkipped?: number;
      slackFailed?: number;
      webhookAttempted?: number;
      webhookSent?: number;
      webhookSkipped?: number;
      webhookFailed?: number;
      emailAttemptsTotal?: number;
      emailRetries?: number;
      slackAttemptsTotal?: number;
      slackRetries?: number;
      webhookAttemptsTotal?: number;
      webhookRetries?: number;
      failures?: Array<{ channel: string; targetKey?: string; status?: number; code?: string; message: string }>;
    };
  }> = [];

  try {
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
            let slackAttempted = 0;
            let slackSent = 0;
            let slackSkipped = 0;
            let slackFailed = 0;
            let webhookAttempted = 0;
            let webhookSent = 0;
            let webhookSkipped = 0;
            let webhookFailed = 0;
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
              const emailCircuit = getCircuitState(breakerState, { channel: 'email', recipientKey }, now);
              if (emailCircuit.muted) {
                skipped += 1;
              }
              const markerExists = emailCircuit.muted ? true : await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey });
              if (markerExists) {
                skipped += 1;
              } else {
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
                recordSendSuccess({ state: breakerState, target: { channel: 'email', recipientKey } });
                } catch {
                  failed += 1;
                  recordSendFailure({ state: breakerState, target: { channel: 'email', recipientKey }, error: { message: 'email_send_failed' }, now });
                }
              }

              const channelResult = await sendChannelNotifications({
                drive,
                folderId: folder.id,
                notify: job.notify,
                mode: 'routes',
                runKey,
                recipientKey,
                profileName: profile.name,
                digest,
                jobMeta: { id: job.id, type: 'week_in_review', dateFromISO: output.dateFromISO, dateToISO: output.dateToISO },
                now,
                breakerState,
              });
              slackAttempted += channelResult.slack.attempted;
              slackSent += channelResult.slack.sent;
              slackSkipped += channelResult.slack.skipped;
              slackFailed += channelResult.slack.failed;
              webhookAttempted += channelResult.webhook.attempted;
              webhookSent += channelResult.webhook.sent;
              webhookSkipped += channelResult.webhook.skipped;
              webhookFailed += channelResult.webhook.failed;
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
              slackAttempted,
              slackSent,
              slackSkipped,
              slackFailed,
              webhookAttempted,
              webhookSent,
              webhookSkipped,
              webhookFailed,
            };
          } else {
            const emailCircuit = getCircuitState(breakerState, { channel: 'email', recipientKey: 'broadcast' }, now);
            const markerExists = emailCircuit.muted ? true : await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey: 'broadcast' });
            let slackAttempted = 0;
            let slackSent = 0;
            let slackSkipped = 0;
            let slackFailed = 0;
            let webhookAttempted = 0;
            let webhookSent = 0;
            let webhookSkipped = 0;
            let webhookFailed = 0;
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
                result.email = { attempted: true, ok: true, mode: 'broadcast', emailAttemptsTotal: sent.attempts ?? 1, emailRetries: Math.max(0, (sent.attempts ?? 1) - 1) };
                recordSendSuccess({ state: breakerState, target: { channel: 'email', recipientKey: 'broadcast' } });
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
                const message = emailError instanceof Error ? emailError.message : 'email_send_failed';
                result.email = {
                  attempted: true,
                  ok: false,
                  mode: 'broadcast',
                  error: message,
                };
                recordSendFailure({ state: breakerState, target: { channel: 'email', recipientKey: 'broadcast' }, error: { message }, now });
              }
            }
            const digest = await buildPersonalizedDigest({
              jobType: 'week_in_review',
              profile: { id: 'broadcast', name: 'broadcast', to: [], filters: {} },
              jobOutput: { ...output, ...notice },
              drive,
              driveFolderId: folder.id,
              accessToken: auth.accessToken,
              now,
              aliasMap: aliases.aliases,
            });
            const channelResult = await sendChannelNotifications({
              drive, folderId: folder.id, notify: job.notify, mode: 'broadcast', runKey, recipientKey: 'broadcast', digest,
              jobMeta: { id: job.id, type: 'week_in_review', dateFromISO: output.dateFromISO, dateToISO: output.dateToISO }, now, breakerState,
            });
            slackAttempted = channelResult.slack.attempted;
            slackSent = channelResult.slack.sent;
            slackSkipped = channelResult.slack.skipped;
            slackFailed = channelResult.slack.failed;
            webhookAttempted = channelResult.webhook.attempted;
            webhookSent = channelResult.webhook.sent;
            webhookSkipped = channelResult.webhook.skipped;
            webhookFailed = channelResult.webhook.failed;
            result.email = { ...(result.email as any), slackAttempted, slackSent, slackSkipped, slackFailed, webhookAttempted, webhookSent, webhookSkipped, webhookFailed, slackAttemptsTotal: channelResult.slack.attemptsTotal, slackRetries: channelResult.slack.retries, webhookAttemptsTotal: channelResult.webhook.attemptsTotal, webhookRetries: channelResult.webhook.retries, failures: channelResult.failures } as any;
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
            let slackAttempted = 0;
            let slackSent = 0;
            let slackSkipped = 0;
            let slackFailed = 0;
            let webhookAttempted = 0;
            let webhookSent = 0;
            let webhookSkipped = 0;
            let webhookFailed = 0;
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
              const emailCircuit = getCircuitState(breakerState, { channel: 'email', recipientKey }, now);
              if (emailCircuit.muted) {
                skipped += 1;
              }
              const markerExists = emailCircuit.muted ? true : await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey });
              if (markerExists) {
                skipped += 1;
              } else {
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
                recordSendSuccess({ state: breakerState, target: { channel: 'email', recipientKey } });
                } catch {
                  failed += 1;
                  recordSendFailure({ state: breakerState, target: { channel: 'email', recipientKey }, error: { message: 'email_send_failed' }, now });
                }
              }

              const channelResult = await sendChannelNotifications({
                drive,
                folderId: folder.id,
                notify: job.notify,
                mode: 'routes',
                runKey,
                recipientKey,
                profileName: profile.name,
                digest,
                jobMeta: { id: job.id, type: 'alerts', dateFromISO: output.lookbackStartISO, dateToISO: output.nowISO, lookbackStartISO: output.lookbackStartISO, nowISO: output.nowISO },
                now,
                breakerState,
              });
              slackAttempted += channelResult.slack.attempted;
              slackSent += channelResult.slack.sent;
              slackSkipped += channelResult.slack.skipped;
              slackFailed += channelResult.slack.failed;
              webhookAttempted += channelResult.webhook.attempted;
              webhookSent += channelResult.webhook.sent;
              webhookSkipped += channelResult.webhook.skipped;
              webhookFailed += channelResult.webhook.failed;
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
              slackAttempted,
              slackSent,
              slackSkipped,
              slackFailed,
              webhookAttempted,
              webhookSent,
              webhookSkipped,
              webhookFailed,
            };
          } else {
            const emailCircuit = getCircuitState(breakerState, { channel: 'email', recipientKey: 'broadcast' }, now);
            const markerExists = emailCircuit.muted ? true : await shouldSendEmailMarkerExists({ drive, folderId: folder.id, runKey, recipientKey: 'broadcast' });
            let slackAttempted = 0;
            let slackSent = 0;
            let slackSkipped = 0;
            let slackFailed = 0;
            let webhookAttempted = 0;
            let webhookSent = 0;
            let webhookSkipped = 0;
            let webhookFailed = 0;
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
                result.email = { attempted: true, ok: true, mode: 'broadcast', emailAttemptsTotal: sent.attempts ?? 1, emailRetries: Math.max(0, (sent.attempts ?? 1) - 1) };
                recordSendSuccess({ state: breakerState, target: { channel: 'email', recipientKey: 'broadcast' } });
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
                const message = emailError instanceof Error ? emailError.message : 'email_send_failed';
                result.email = {
                  attempted: true,
                  ok: false,
                  mode: 'broadcast',
                  error: message,
                };
                recordSendFailure({ state: breakerState, target: { channel: 'email', recipientKey: 'broadcast' }, error: { message }, now });
              }
            }
            const digest = await buildPersonalizedDigest({
              jobType: 'alerts',
              profile: { id: 'broadcast', name: 'broadcast', to: [], filters: {} },
              jobOutput: output,
              drive,
              driveFolderId: folder.id,
              accessToken: auth.accessToken,
              now,
              aliasMap: aliases.aliases,
            });
            const channelResult = await sendChannelNotifications({
              drive, folderId: folder.id, notify: job.notify, mode: 'broadcast', runKey, recipientKey: 'broadcast', digest,
              jobMeta: { id: job.id, type: 'alerts', lookbackStartISO: output.lookbackStartISO, nowISO: output.nowISO }, now, breakerState,
            });
            slackAttempted = channelResult.slack.attempted;
            slackSent = channelResult.slack.sent;
            slackSkipped = channelResult.slack.skipped;
            slackFailed = channelResult.slack.failed;
            webhookAttempted = channelResult.webhook.attempted;
            webhookSent = channelResult.webhook.sent;
            webhookSkipped = channelResult.webhook.skipped;
            webhookFailed = channelResult.webhook.failed;
            result.email = { ...(result.email as any), slackAttempted, slackSent, slackSkipped, slackFailed, webhookAttempted, webhookSent, webhookSkipped, webhookFailed, slackAttemptsTotal: channelResult.slack.attemptsTotal, slackRetries: channelResult.slack.retries, webhookAttemptsTotal: channelResult.webhook.attemptsTotal, webhookRetries: channelResult.webhook.retries, failures: channelResult.failures } as any;
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
        failures: ranJobs[ranJobs.length - 1]?.email?.failures,
        durationMs: Date.now() - started,
      },
    });
  }

    return NextResponse.json({ ok: true, ranJobs });
  } finally {
    await saveCircuitBreakers(drive, folder.id, breakerState).catch(() => undefined);
    await releaseCronLock({ drive, driveFolderId: folder.id, holder: lockHolder });
  }
};

export const POST = run;
export const GET = run;
