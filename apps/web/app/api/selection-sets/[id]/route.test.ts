import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/selectionSets', () => ({
  readGmailSelectionSetFromDrive: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { readGmailSelectionSetFromDrive } from '../../../lib/selectionSets';
import { GET } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockReadGmailSelectionSetFromDrive = vi.mocked(readGmailSelectionSetFromDrive);

describe('GET /api/selection-sets/:id', () => {
  it('returns reconnect_required for missing session', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost') as never, {
      params: { id: 'set-1' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'reconnect_required', message: 'Reconnect required.' },
      error_code: 'reconnect_required',
    });
  });

  it('returns a selection set by id', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockReadGmailSelectionSetFromDrive.mockResolvedValue({
      kind: 'gmail_selection_set',
      version: 1,
      id: 'set-1',
      title: 'Invoices',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      source: 'gmail',
      query: {
        q: 'from:billing@example.com newer_than:30d',
        senders: ['billing@example.com'],
        datePreset: '30d',
        customAfter: null,
        hasAttachment: false,
        freeText: '',
      },
    });

    const response = await GET(new Request('http://localhost') as never, {
      params: { id: 'set-1' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      set: {
        id: 'set-1',
        title: 'Invoices',
      },
    });
  });
});
