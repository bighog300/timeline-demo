import { z } from 'zod';

const FailureSchema = z.object({
  tsISO: z.string(),
  jobId: z.string(),
  type: z.string(),
  channel: z.string().optional(),
  targetKey: z.string().optional(),
  status: z.number().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
}).strict();

export const OpsStatusSchema = z.object({
  ok: z.literal(true),
  generatedAtISO: z.string(),
  scheduler: z.object({
    lock: z.object({ held: z.boolean(), leaseUntilISO: z.string().optional() }).strict(),
    lastCronRunISO: z.string().optional(),
  }).strict(),
  jobs: z.array(z.object({
    jobId: z.string(),
    type: z.enum(['week_in_review', 'alerts']),
    enabled: z.boolean(),
    schedule: z.object({ cron: z.string(), timezone: z.string() }).strict(),
    lastRun: z.object({ tsISO: z.string(), ok: z.boolean(), durationMs: z.number().optional(), notes: z.string().optional() }).optional(),
    lastNotification: z.object({
      email: z.object({ sent: z.number().optional(), failed: z.number().optional(), skipped: z.number().optional(), attemptsTotal: z.number().optional() }).optional(),
      slack: z.object({ sent: z.number().optional(), failed: z.number().optional(), skipped: z.number().optional(), attemptsTotal: z.number().optional(), missingTargets: z.array(z.string()).optional() }).optional(),
      webhook: z.object({ sent: z.number().optional(), failed: z.number().optional(), skipped: z.number().optional(), attemptsTotal: z.number().optional(), missingTargets: z.array(z.string()).optional() }).optional(),
      perProfileReports: z.object({ saved: z.number().optional(), reused: z.number().optional(), skipped: z.number().optional(), failed: z.number().optional() }).optional(),
    }).optional(),
    issues: z.array(z.enum(['missing_env_targets', 'missing_refresh_token', 'insufficient_scope', 'recent_failures'])).optional(),
  }).strict()),
  issues: z.object({
    missingEnvTargets: z.object({ slack: z.array(z.string()), webhook: z.array(z.string()) }).strict(),
    auth: z.object({ missingRefreshToken: z.boolean(), insufficientScope: z.boolean(), notes: z.array(z.string()) }).strict(),
    recentFailures: z.array(FailureSchema),
  }).strict(),
}).strict();

export type OpsStatus = z.infer<typeof OpsStatusSchema>;
