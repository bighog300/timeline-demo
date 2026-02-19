import { describe, expect, it, vi } from 'vitest';

import { postWebhook, WebhookPayloadV1Schema } from './webhook';

describe('webhook', () => {
  it('validates payload schema and posts json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const payload = {
      version: 1,
      job: { id: 'week', type: 'week_in_review', runKey: 'rk' },
      recipient: { key: 'broadcast' },
      summary: { risks: 1, openLoops: 2, decisions: 3, actions: 0 },
      top: {},
      links: {},
    };
    expect(WebhookPayloadV1Schema.parse(payload).version).toBe(1);
    await postWebhook({ url: 'https://example.com/hook', payload });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
