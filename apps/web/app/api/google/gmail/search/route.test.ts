import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleGmail', () => ({
  createGmailClient: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createGmailClient } from '../../../../lib/googleGmail';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateGmailClient = vi.mocked(createGmailClient);

const listMock = vi.fn();
const getMock = vi.fn();

describe('POST /api/google/gmail/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGmailClient.mockReturnValue({
      users: {
        messages: {
          list: listMock,
          get: getMock,
        },
      },
    } as never);
  });

  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await POST(
      new Request('http://localhost/api/google/gmail/search', {
        method: 'POST',
        body: JSON.stringify({ q: 'from:test@example.com' }),
      }) as never,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'reconnect_required',
      message: 'Reconnect Google',
    });
  });

  it('passes q, maxResults, and pageToken to Gmail list', async () => {
    mockGetGoogleSession.mockResolvedValue({ user: { email: 'a@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    listMock.mockResolvedValue({
      data: {
        messages: [{ id: 'm-1' }],
        nextPageToken: 'next-token',
      },
    });
    getMock.mockResolvedValue({
      data: {
        id: 'm-1',
        threadId: 't-1',
        internalDate: '1700000000000',
        snippet: 'snippet',
        payload: {
          headers: [
            { name: 'From', value: 'Test Sender <test@example.com>' },
            { name: 'Subject', value: 'Hello' },
            { name: 'Date', value: 'Mon, 1 Jan 2024 00:00:00 +0000' },
          ],
        },
      },
    });

    const response = await POST(
      new Request('http://localhost/api/google/gmail/search', {
        method: 'POST',
        body: JSON.stringify({ q: 'from:test@example.com', maxResults: 10, pageToken: 'abc' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(
      {
        userId: 'me',
        q: 'from:test@example.com',
        maxResults: 10,
        pageToken: 'abc',
      },
      expect.any(Object),
    );

    const payload = (await response.json()) as { messages: Array<{ id: string; from: { email: string } }> };
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({
      id: 'm-1',
      from: {
        email: 'test@example.com',
      },
    });
  });

  it('maps Google 429 errors through consistent payload', async () => {
    mockGetGoogleSession.mockResolvedValue({ user: { email: 'a@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    listMock.mockRejectedValue({
      response: {
        status: 429,
      },
    });

    const response = await POST(
      new Request('http://localhost/api/google/gmail/search', {
        method: 'POST',
        body: JSON.stringify({ q: 'from:test@example.com' }),
      }) as never,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'rate_limited',
      message: 'Too many requests. Try again in a moment.',
    });
  });
});
