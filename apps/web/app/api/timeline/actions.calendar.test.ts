import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../lib/timeline/artifactIndex', () => ({
  loadArtifactIndex: vi.fn().mockResolvedValue({ index: { version: 1, updatedAtISO: '2024-01-01T00:00:00Z', artifacts: [] }, fileId: 'index-1' }),
  saveArtifactIndex: vi.fn(),
  upsertArtifactIndexEntry: vi.fn((index, entry) => ({ ...index, artifacts: [entry] })),
}));

vi.mock('../../lib/googleCalendar', () => ({
  createCalendarEvent: vi.fn(),
  GoogleCalendarApiError: class GoogleCalendarApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public details?: unknown,
    ) {
      super(message);
      this.name = 'GoogleCalendarApiError';
    }
  },
}));

import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createCalendarEvent, GoogleCalendarApiError } from '../../lib/googleCalendar';
import { createDriveClient } from '../../lib/googleDrive';
import { POST } from './actions/route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockCreateCalendarEvent = vi.mocked(createCalendarEvent);

const buildArtifact = (overrides?: Record<string, unknown>) => ({
  type: 'summary',
  status: 'complete',
  id: 'artifact-file-1',
  artifactId: 'gmail:1',
  source: 'gmail',
  sourceId: '1',
  title: 'Title',
  createdAtISO: '2024-01-01T00:00:00Z',
  updatedAtISO: '2024-01-01T00:00:00Z',
  summary: 'summary',
  highlights: [],
  driveFolderId: 'folder-1',
  driveFileId: 'artifact-file-1',
  model: 'stub',
  version: 1,
  meta: { driveFileId: 'artifact-file-1', driveFolderId: 'folder-1', source: 'gmail', sourceId: '1', model: 'stub', version: 1 },
  suggestedActions: [
    {
      id: 'act-calendar',
      type: 'calendar',
      text: 'Set planning meeting',
      dueDateISO: '2024-02-10T09:00:00Z',
      status: 'proposed',
      createdAtISO: '2024-01-01T00:00:00Z',
      updatedAtISO: '2024-01-01T00:00:00Z',
    },
  ],
  ...overrides,
});

describe('POST /api/timeline/actions calendar integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1', user: { email: 'test@example.com' } } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateCalendarEvent.mockReset();
  });

  it('accepts calendar action with dueDateISO, creates event, and persists metadata', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    const get = vi.fn().mockResolvedValue({ data: buildArtifact() });
    mockCreateCalendarEvent.mockResolvedValue({
      id: 'event-123',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=abc',
      startISO: '2024-02-10T09:00:00Z',
      endISO: '2024-02-10T10:00:00Z',
    });
    mockCreateDriveClient.mockReturnValue({ files: { get, update, list: vi.fn().mockResolvedValue({ data: { files: [] } }), create: vi.fn() } } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'act-calendar', decision: 'accept' }),
    }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.calendarEvent).toMatchObject({ id: 'event-123' });
    expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
    const body = JSON.parse(update.mock.calls[0][0].media.body as string);
    expect(body.suggestedActions[0].calendarEvent).toMatchObject({ id: 'event-123' });
    expect(body.suggestedActions[0].status).toBe('accepted');
  });

  it('returns 400 when calendar action is accepted without dueDateISO', async () => {
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact({ suggestedActions: [{ id: 'act-calendar', type: 'calendar', text: 'Set planning meeting', status: 'proposed' }] }) }),
        update: vi.fn(),
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        create: vi.fn(),
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'act-calendar', decision: 'accept' }),
    }) as never);

    expect(response.status).toBe(400);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it('returns 502 and keeps artifact unchanged when calendar API fails', async () => {
    const update = vi.fn();
    mockCreateCalendarEvent.mockRejectedValue(new GoogleCalendarApiError(500, 'backendError', 'Calendar API down'));
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({ data: buildArtifact() }),
        update,
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        create: vi.fn(),
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'act-calendar', decision: 'accept' }),
    }) as never);

    expect(response.status).toBe(502);
    expect(update).not.toHaveBeenCalled();
  });

  it('is idempotent when accepted calendar action already has event metadata', async () => {
    const update = vi.fn();
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({
          data: buildArtifact({
            suggestedActions: [
              {
                id: 'act-calendar',
                type: 'calendar',
                text: 'Set planning meeting',
                dueDateISO: '2024-02-10T09:00:00Z',
                status: 'accepted',
                calendarEvent: {
                  id: 'event-123',
                  htmlLink: 'https://calendar.google.com/calendar/event?eid=abc',
                  startISO: '2024-02-10T09:00:00Z',
                  endISO: '2024-02-10T10:00:00Z',
                  createdAtISO: '2024-01-05T00:00:00Z',
                },
              },
            ],
          }),
        }),
        update,
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        create: vi.fn(),
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'act-calendar', decision: 'accept' }),
    }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.calendarEvent.id).toBe('event-123');
    expect(update).not.toHaveBeenCalled();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it('keeps non-calendar accept behavior unchanged', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 'artifact-file-1' } });
    mockCreateDriveClient.mockReturnValue({
      files: {
        get: vi.fn().mockResolvedValue({
          data: buildArtifact({
            suggestedActions: [
              { id: 'act-task', type: 'task', text: 'Do it', status: 'proposed', createdAtISO: '2024-01-01T00:00:00Z', updatedAtISO: '2024-01-01T00:00:00Z' },
            ],
          }),
        }),
        update,
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        create: vi.fn(),
      },
    } as never);

    const response = await POST(new Request('http://localhost/api/timeline/actions', {
      method: 'POST',
      body: JSON.stringify({ artifactId: 'artifact-file-1', actionId: 'act-task', decision: 'accept' }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
    const body = JSON.parse(update.mock.calls[0][0].media.body as string);
    expect(body.suggestedActions[0].status).toBe('accepted');
  });
});
