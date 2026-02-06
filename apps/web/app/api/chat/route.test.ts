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

    const payload = (await response.json()) as { reply: string };

    expect(payload).toEqual({ reply: 'You said: Hello there' });
  });

  it('returns a default reply when message is empty', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { reply: string };

    expect(payload.reply).toEqual(expect.any(String));
  });
});
