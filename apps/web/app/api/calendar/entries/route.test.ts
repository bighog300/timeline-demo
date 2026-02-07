import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);

const buildRequest = (url: string) => {
  const request = new Request(url) as never;
  (request as { nextUrl?: URL }).nextUrl = new URL(url);
  return request;
};

const validEntry = {
  type: 'calendar_entry',
  id: 'cal-1',
  title: 'Q1 planning',
  startISO: '2024-01-15T09:00:00Z',
  endISO: '2024-01-15T10:00:00Z',
  allDay: false,
  location: 'Room 3B',
  notes: 'Bring a draft.',
  tags: ['planning'],
  links: [{ kind: 'summary', id: 'file-1' }],
  source: 'user',
  createdAtISO: '2024-01-10T10:00:00Z',
  updatedAtISO: '2024-01-11T10:00:00Z',
};

describe('GET /api/calendar/entries', () => {
  it('returns entries from Drive', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const listSpy = vi.fn().mockResolvedValue({
      data: {
        files: [
          { id: 'file-1', name: 'Q1 planning - CalendarEntry.json', mimeType: 'application/json' },
        ],
      },
    });
    const getSpy = vi.fn().mockResolvedValue({ data: validEntry });
    mockCreateDriveClient.mockReturnValue({
      files: { list: listSpy, get: getSpy },
    } as never);

    const response = await GET(buildRequest('http://localhost/api/calendar/entries'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      entries: [validEntry],
      nextPageToken: undefined,
    });
  });

  it('skips invalid JSON entries and continues', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const listSpy = vi.fn().mockResolvedValue({
      data: {
        files: [
          { id: 'file-1', name: 'Entry 1 - CalendarEntry.json', mimeType: 'application/json' },
          { id: 'file-2', name: 'Entry 2 - CalendarEntry.json', mimeType: 'application/json' },
        ],
      },
    });
    const getSpy = vi
      .fn()
      .mockResolvedValueOnce({ data: { ...validEntry, id: 'cal-1' } })
      .mockResolvedValueOnce({ data: { type: 'calendar_entry', id: 123 } });
    mockCreateDriveClient.mockReturnValue({
      files: { list: listSpy, get: getSpy },
    } as never);

    const response = await GET(buildRequest('http://localhost/api/calendar/entries'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].id).toBe('cal-1');
  });

  it('scopes listing to the app folder', async () => {
    mockGetGoogleSession.mockResolvedValue({
      driveFolderId: 'folder-1',
      user: { email: 'test@example.com' },
    } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');

    const listSpy = vi.fn().mockResolvedValue({ data: { files: [] } });
    mockCreateDriveClient.mockReturnValue({
      files: { list: listSpy, get: vi.fn() },
    } as never);

    const response = await GET(buildRequest('http://localhost/api/calendar/entries'));

    expect(response.status).toBe(200);
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "'folder-1' in parents and trashed=false and name contains 'CalendarEntry.json'",
      }),
      expect.any(Object),
    );
  });
});
