import { defaultIsRetryableError, withRetry, type RetryableError } from '../net/retry';

export class SlackWebhookError extends Error {
  status: number;

  attempts?: number;

  constructor(message: string, status: number, attempts?: number) {
    super(message);
    this.name = 'SlackWebhookError';
    this.status = status;
    this.attempts = attempts;
  }
}

const toRetryableError = (error: unknown): RetryableError => {
  if (error instanceof SlackWebhookError) {
    return { kind: 'http', status: error.status, message: error.message };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'timeout', message: 'slack_timeout' };
  }
  if (error instanceof Error) {
    return { kind: 'network', message: error.message || 'slack_network_error' };
  }
  return { kind: 'network', message: 'slack_network_error' };
};

export const postSlackMessage = async ({
  webhookUrl,
  text,
  blocks,
}: {
  webhookUrl: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
}) => {
  const result = await withRetry(async () => {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(blocks ? { blocks } : {}) }),
    });

    if (!response.ok) {
      throw new SlackWebhookError('slack_webhook_failed', response.status);
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
    throw new SlackWebhookError(result.error.message, result.error.status ?? 502, result.attempts);
  }

  return { attempts: result.attempts };
};
