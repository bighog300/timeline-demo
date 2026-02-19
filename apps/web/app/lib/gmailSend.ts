export class GmailApiError extends Error {
  status: number;

  code: string;

  details?: unknown;

  constructor(message: string, status: number, code = 'gmail_send_failed', details?: unknown) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
    this.code = code;
    this.details = details;
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
}): Promise<{ id: string; threadId?: string }> => {
  const mime = buildMimeMessage({ fromEmail, to, cc, subject, textBody });
  const raw = toBase64Url(mime);

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
};
