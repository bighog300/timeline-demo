import { z } from 'zod';

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

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WebhookError';
    this.status = status;
  }
}

export const postWebhook = async ({ url, payload, headers }: { url: string; payload: unknown; headers?: Record<string, string> }) => {
  const parsed = WebhookPayloadV1Schema.parse(payload);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    throw new WebhookError('webhook_failed', response.status);
  }
};
