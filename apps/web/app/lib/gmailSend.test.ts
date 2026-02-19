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
    ).resolves.toMatchObject({ id: 'msg-1', threadId: 'thread-1', attempts: 1 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { raw: string };
    expect(body.raw).not.toMatch(/[+=/]/);
  });

  it('retries on upstream 500 and 429', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'msg-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail({ accessToken: 't', fromEmail: 'a@b.com', to: ['c@d.com'], subject: 's', textBody: 'b' })).resolves.toMatchObject({ attempts: 3 });
  });

  it('throws GmailApiError on non-retryable 4xx', async () => {
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
