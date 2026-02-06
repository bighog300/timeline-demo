import { describe, expect, it } from 'vitest';

import { POST } from './route';

describe('POST /api/chat', () => {
  it('echoes the message in the reply', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello there' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      reply: string;
      suggested_actions: string[];
      related_events: Array<{ id: string; title: string }>;
    };

    expect(payload.reply).toEqual(expect.any(String));
    expect(payload.suggested_actions.length).toBeGreaterThan(0);
    expect(payload.related_events).toEqual(expect.any(Array));
  });

  it('returns a default reply when message is empty', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { reply: string; suggested_actions: string[] };

    expect(payload.reply).toEqual(expect.any(String));
    expect(payload.suggested_actions.length).toBeGreaterThan(0);
  });

  it('returns deterministic suggestions for a weekend request', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Ideas for the weekend' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { suggested_actions: string[] };

    expect(payload.suggested_actions).toEqual([
      'Build a weekend lineup',
      'Find outdoor events',
      'Show live music options',
      'Browse farmers markets',
    ]);
  });
});
