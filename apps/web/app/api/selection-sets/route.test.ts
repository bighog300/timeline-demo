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
  buildDriveSelectionSet: vi.fn(),
  writeSelectionSetToDrive: vi.fn(),
  listSelectionSetsFromDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createDriveClient } from '../../lib/googleDrive';
import {
  buildDriveSelectionSet,
  buildGmailSelectionSet,
  listSelectionSetsFromDrive,
  writeSelectionSetToDrive,
} from '../../lib/selectionSets';
import { GET, POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockBuildGmailSelectionSet = vi.mocked(buildGmailSelectionSet);
const mockBuildDriveSelectionSet = vi.mocked(buildDriveSelectionSet);
const mockWriteSelectionSetToDrive = vi.mocked(writeSelectionSetToDrive);
const mockListSelectionSetsFromDrive = vi.mocked(listSelectionSetsFromDrive);

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

  it('POST writes a gmail selection set', async () => {
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
    mockWriteSelectionSetToDrive.mockResolvedValue({
      driveFileId: 'drive-file-1',
      modifiedTime: '2024-01-01T00:00:00.000Z',
    });

    const response = await POST(
      new Request('http://localhost/api/selection-sets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'gmail',
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
      kind: 'gmail_selection_set',
      source: 'gmail',
    });
  });

  it('GET returns mixed metadata list', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockListSelectionSetsFromDrive.mockResolvedValue([
      { id: 'set-1', title: 'Invoices', updatedAt: '2024-01-01T00:00:00.000Z', kind: 'gmail_selection_set', source: 'gmail' },
      { id: 'set-2', title: 'Quarterly PDFs', updatedAt: '2024-01-02T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sets: [
        { id: 'set-1', title: 'Invoices', updatedAt: '2024-01-01T00:00:00.000Z', kind: 'gmail_selection_set', source: 'gmail' },
        { id: 'set-2', title: 'Quarterly PDFs', updatedAt: '2024-01-02T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' },
      ],
    });
  });

  it('POST writes a drive selection set', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockBuildDriveSelectionSet.mockReturnValue({
      kind: 'drive_selection_set',
      version: 1,
      id: 'set-drive-1',
      title: 'PDFs',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      source: 'drive',
      query: {
        q: "trashed=false and mimeType='application/pdf'",
        nameContains: '',
        mimeGroup: 'pdf',
        modifiedPreset: '30d',
        modifiedAfter: null,
        inFolderId: null,
        ownerEmail: null,
      },
    });
    mockWriteSelectionSetToDrive.mockResolvedValue({ driveFileId: 'drive-file-2', modifiedTime: '2024-01-01T00:00:00.000Z' });

    const response = await POST(
      new Request('http://localhost/api/selection-sets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'drive',
          title: 'PDFs',
          query: {
            q: "trashed=false and mimeType='application/pdf'",
            mimeGroup: 'pdf',
            modifiedPreset: '30d',
            nameContains: '',
          },
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'set-drive-1',
      kind: 'drive_selection_set',
      source: 'drive',
    });
  });
});
