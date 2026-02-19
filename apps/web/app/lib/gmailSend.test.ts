import { describe, expect, it, vi } from 'vitest';

import { GmailApiError, sendEmail } from './gmailSend';

describe('gmailSend', () => {
  it('sends base64url encoded MIME payload to Gmail API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', threadId: 'thread-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendEmail({
        accessToken: 'token',
        fromEmail: 'sender@example.com',
        to: ['to@example.com'],
        cc: ['cc@example.com'],
        subject: 'Hello',
        textBody: 'Body text',
      }),
    ).resolves.toEqual({ id: 'msg-1', threadId: 'thread-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      expect.objectContaining({ method: 'POST' }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { raw: string };
    expect(body.raw).not.toMatch(/[+=/]/);
    const decoded = Buffer.from(body.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(decoded).toContain('Subject: Hello');
    expect(decoded).toContain('To: to@example.com');
  });

  it('throws GmailApiError on upstream failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'bad token' }) }),
    );

    await expect(
      sendEmail({
        accessToken: 'bad',
        fromEmail: 'sender@example.com',
        to: ['to@example.com'],
        subject: 'Hello',
        textBody: 'Body text',
      }),
    ).rejects.toBeInstanceOf(GmailApiError);
  });
});
