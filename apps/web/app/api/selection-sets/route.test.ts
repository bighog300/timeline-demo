import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../lib/selectionSets', () => ({
  buildGmailSelectionSet: vi.fn(),
  writeGmailSelectionSetToDrive: vi.fn(),
  listGmailSelectionSetsFromDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createDriveClient } from '../../lib/googleDrive';
import {
  buildGmailSelectionSet,
  listGmailSelectionSetsFromDrive,
  writeGmailSelectionSetToDrive,
} from '../../lib/selectionSets';
import { GET, POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockBuildGmailSelectionSet = vi.mocked(buildGmailSelectionSet);
const mockWriteGmailSelectionSetToDrive = vi.mocked(writeGmailSelectionSetToDrive);
const mockListGmailSelectionSetsFromDrive = vi.mocked(listGmailSelectionSetsFromDrive);

describe('/api/selection-sets', () => {
  it('returns reconnect_required when session missing', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'reconnect_required', message: 'Reconnect required.' },
      error_code: 'reconnect_required',
    });
  });

  it('POST writes a selection set', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockBuildGmailSelectionSet.mockReturnValue({
      kind: 'gmail_selection_set',
      version: 1,
      id: 'set-1',
      title: 'Invoices',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      source: 'gmail',
      query: {
        q: 'from:billing@example.com newer_than:30d',
        senders: ['billing@example.com'],
        datePreset: '30d',
        customAfter: null,
        hasAttachment: true,
        freeText: 'invoice',
      },
    });
    mockWriteGmailSelectionSetToDrive.mockResolvedValue({
      driveFileId: 'drive-file-1',
      modifiedTime: '2024-01-01T00:00:00.000Z',
    });

    const response = await POST(
      new Request('http://localhost/api/selection-sets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Invoices',
          query: {
            q: 'from:billing@example.com newer_than:30d',
            senders: ['billing@example.com'],
            datePreset: '30d',
            customAfter: null,
            hasAttachment: true,
            freeText: 'invoice',
          },
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'set-1',
      title: 'Invoices',
      driveFileId: 'drive-file-1',
    });
  });

  it('GET returns metadata list', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockListGmailSelectionSetsFromDrive.mockResolvedValue([
      { id: 'set-1', title: 'Invoices', updatedAt: '2024-01-01T00:00:00.000Z' },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sets: [{ id: 'set-1', title: 'Invoices', updatedAt: '2024-01-01T00:00:00.000Z' }],
    });
  });
});
