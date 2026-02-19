import { z } from 'zod';

import { defaultIsRetryableError, withRetry, type RetryableError } from '../net/retry';

const boundedText = z.string().trim().min(1).max(240);

export const WebhookPayloadV1Schema = z.object({
  version: z.literal(1),
  job: z.object({
    id: z.string().min(1).max(80),
    type: z.enum(['week_in_review', 'alerts']),
    runKey: z.string().min(1).max(200),
    dateFromISO: z.string().optional(),
    dateToISO: z.string().optional(),
    lookbackStartISO: z.string().optional(),
    nowISO: z.string().optional(),
  }).strict(),
  recipient: z.object({ key: z.string().min(1).max(40), profileName: z.string().max(80).optional() }).strict(),
  summary: z.object({ risks: z.number(), openLoops: z.number(), decisions: z.number(), actions: z.number() }).strict(),
  top: z.object({
    risks: z.array(z.object({ text: boundedText, severity: z.string().optional(), owner: z.string().max(120).optional(), dueDateISO: z.string().optional() }).strict()).optional(),
    openLoops: z.array(z.object({ text: boundedText, owner: z.string().max(120).optional(), dueDateISO: z.string().optional(), status: z.string().optional() }).strict()).optional(),
    decisions: z.array(z.object({ text: boundedText, dateISO: z.string().optional(), owner: z.string().max(120).optional() }).strict()).optional(),
    actions: z.array(z.object({ type: z.string().max(40), text: boundedText, dueDateISO: z.string().optional() }).strict()).optional(),
  }).strict(),
  links: z.object({ dashboardUrl: z.string().optional(), drilldownUrl: z.string().optional(), reportUrl: z.string().optional(), synthesisUrl: z.string().optional() }).strict(),
}).strict();

export class WebhookError extends Error {
  status: number;

  attempts?: number;

  constructor(message: string, status: number, attempts?: number) {
    super(message);
    this.name = 'WebhookError';
    this.status = status;
    this.attempts = attempts;
  }
}

const toRetryableError = (error: unknown): RetryableError => {
  if (error instanceof WebhookError) {
    return { kind: 'http', status: error.status, message: error.message };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'timeout', message: 'webhook_timeout' };
  }
  if (error instanceof Error) {
    return { kind: 'network', message: error.message || 'webhook_network_error' };
  }
  return { kind: 'network', message: 'webhook_network_error' };
};

export const postWebhook = async ({ url, payload, headers }: { url: string; payload: unknown; headers?: Record<string, string> }) => {
  const parsed = WebhookPayloadV1Schema.parse(payload);
  const result = await withRetry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(parsed),
    });

    if (!response.ok) {
      throw new WebhookError('webhook_failed', response.status);
    }
  }, {
    maxAttempts: 3,
    baseDelayMs: 200,
    maxDelayMs: 1500,
    maxTotalMs: 3500,
    isRetryable: defaultIsRetryableError,
    mapError: toRetryableError,
  });

  if (!result.ok) {
    throw new WebhookError(result.error.message, result.error.status ?? 502, result.attempts);
  }

  return { attempts: result.attempts };
};
