import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);

const listMock = vi.fn();

describe('POST /api/google/drive/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDriveClient.mockReturnValue({
      files: {
        list: listMock,
      },
    } as never);
  });

  it('returns reconnect_required when not authenticated', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await POST(
      new Request('http://localhost/api/google/drive/search', {
        method: 'POST',
        body: JSON.stringify({ q: "trashed=false" }),
      }) as never,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'reconnect_required',
      message: 'Reconnect Google',
    });
  });

  it('passes q, pageSize, and pageToken to drive.files.list and maps files', async () => {
    mockGetGoogleSession.mockResolvedValue({ user: { email: 'a@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    listMock.mockResolvedValue({
      data: {
        nextPageToken: 'next-1',
        files: [
          {
            id: 'file-1',
            name: 'Roadmap',
            mimeType: 'application/pdf',
            modifiedTime: '2026-02-01T00:00:00.000Z',
            createdTime: '2026-01-01T00:00:00.000Z',
            size: '1234',
            webViewLink: 'https://drive.google.com/file/d/file-1/view',
            owners: [{ displayName: 'Owner Name', emailAddress: 'owner@example.com' }],
            parents: ['folder-1'],
          },
        ],
      },
    });

    const response = await POST(
      new Request('http://localhost/api/google/drive/search', {
        method: 'POST',
        body: JSON.stringify({ q: "trashed=false", pageSize: 50, pageToken: 'tok-1' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(
      {
        q: 'trashed=false',
        pageToken: 'tok-1',
        pageSize: 50,
        orderBy: 'modifiedTime desc',
        fields:
          'nextPageToken, files(id,name,mimeType,modifiedTime,createdTime,owners(displayName,emailAddress),size,webViewLink,parents)',
        spaces: 'drive',
      },
      expect.any(Object),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      query: 'trashed=false',
      resultCount: 1,
      nextPageToken: 'next-1',
      files: [
        {
          id: 'file-1',
          name: 'Roadmap',
          owner: {
            name: 'Owner Name',
            email: 'owner@example.com',
          },
          parents: ['folder-1'],
        },
      ],
    });
  });

  it('maps Google 429 errors through consistent payload', async () => {
    mockGetGoogleSession.mockResolvedValue({ user: { email: 'a@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    listMock.mockRejectedValue({ response: { status: 429 } });

    const response = await POST(
      new Request('http://localhost/api/google/drive/search', {
        method: 'POST',
        body: JSON.stringify({ q: 'trashed=false' }),
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
