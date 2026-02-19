import { describe, expect, it, vi } from 'vitest';

import { postWebhook, WebhookPayloadV1Schema } from './webhook';

const payload = {
  version: 1,
  job: { id: 'week', type: 'week_in_review', runKey: 'rk' },
  recipient: { key: 'broadcast' },
  summary: { risks: 1, openLoops: 2, decisions: 3, actions: 0 },
  top: {},
  links: {},
};

describe('webhook', () => {
  it('validates payload schema and posts json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    expect(WebhookPayloadV1Schema.parse(payload).version).toBe(1);
    await expect(postWebhook({ url: 'https://example.com/hook', payload })).resolves.toMatchObject({ attempts: 1 });
  });

  it('retries transient 500 failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(postWebhook({ url: 'https://example.com/hook', payload })).resolves.toMatchObject({ attempts: 2 });
  });
});
