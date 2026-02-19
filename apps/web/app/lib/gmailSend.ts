import { defaultIsRetryableError, withRetry, type RetryableError } from './net/retry';

export class GmailApiError extends Error {
  status: number;

  code: string;

  details?: unknown;

  attempts?: number;

  constructor(message: string, status: number, code = 'gmail_send_failed', details?: unknown, attempts?: number) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.attempts = attempts;
  }
}

const toBase64Url = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const sanitizeHeaderValue = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

const buildMimeMessage = ({
  fromEmail,
  to,
  cc,
  subject,
  textBody,
}: {
  fromEmail: string;
  to: string[];
  cc?: string[];
  subject: string;
  textBody: string;
}) => {
  const lines = [
    `From: ${sanitizeHeaderValue(fromEmail)}`,
    `To: ${to.map(sanitizeHeaderValue).join(', ')}`,
    ...(cc?.length ? [`Cc: ${cc.map(sanitizeHeaderValue).join(', ')}`] : []),
    `Subject: ${sanitizeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    textBody,
  ];

  return lines.join('\r\n');
};

const toRetryableError = (error: unknown): RetryableError => {
  if (error instanceof GmailApiError) {
    return { kind: 'http', status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'timeout', message: 'gmail_timeout' };
  }
  if (error instanceof Error) {
    return { kind: 'network', message: error.message || 'gmail_network_error' };
  }
  return { kind: 'network', message: 'gmail_network_error' };
};

export const sendEmail = async ({
  accessToken,
  fromEmail,
  to,
  cc,
  subject,
  textBody,
}: {
  accessToken: string;
  fromEmail: string;
  to: string[];
  cc?: string[];
  subject: string;
  textBody: string;
}): Promise<{ id: string; threadId?: string; attempts: number }> => {
  const mime = buildMimeMessage({ fromEmail, to, cc, subject, textBody });
  const raw = toBase64Url(mime);

  const result = await withRetry(async () => {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!response.ok) {
      let details: unknown;
      try {
        details = await response.json();
      } catch {
        details = await response.text();
      }
      throw new GmailApiError('Gmail send failed', response.status, 'gmail_send_failed', details);
    }

    const payload = (await response.json()) as { id?: string; threadId?: string };
    if (!payload.id) {
      throw new GmailApiError('Gmail send failed: missing id', 502, 'gmail_send_missing_id', payload);
    }

    return { id: payload.id, threadId: payload.threadId };
  }, {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 1500,
    maxTotalMs: 4500,
    isRetryable: defaultIsRetryableError,
    mapError: toRetryableError,
  });

  if (!result.ok) {
    throw new GmailApiError(result.error.message, result.error.status ?? 502, result.error.code ?? 'gmail_send_failed', undefined, result.attempts);
  }

  return { ...result.value, attempts: result.attempts };
};
