import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../lib/selectionSets', () => ({
  readSelectionSetFromDrive: vi.fn(),
  updateSelectionSetTitle: vi.fn(),
  deleteSelectionSet: vi.fn(),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { deleteSelectionSet, readSelectionSetFromDrive, updateSelectionSetTitle } from '../../../lib/selectionSets';
import { DELETE, GET, PATCH } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockReadGmailSelectionSetFromDrive = vi.mocked(readSelectionSetFromDrive);
const mockUpdateSelectionSetTitle = vi.mocked(updateSelectionSetTitle);
const mockDeleteSelectionSet = vi.mocked(deleteSelectionSet);

describe('GET /api/selection-sets/:id', () => {
  it('returns reconnect_required for missing session', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost') as never, {
      params: Promise.resolve({ id: 'set-1' }),
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
      params: Promise.resolve({ id: 'set-1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      set: {
        id: 'set-1',
        title: 'Invoices',
      },
    });
  });

  it('PATCH updates title and updatedAt', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockUpdateSelectionSetTitle.mockResolvedValue({
      kind: 'drive_selection_set',
      version: 1,
      id: 'set-1',
      title: 'Renamed title',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
      source: 'drive',
      query: {
        q: 'trashed=false',
        nameContains: '',
        mimeGroup: 'any',
        modifiedPreset: '30d',
        modifiedAfter: null,
        inFolderId: null,
        ownerEmail: null,
      },
    });

    const response = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed title' }),
      }) as never,
      { params: Promise.resolve({ id: 'set-1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'set-1',
      title: 'Renamed title',
      updatedAt: '2024-02-01T00:00:00.000Z',
      kind: 'drive_selection_set',
      source: 'drive',
    });
  });

  it('DELETE deletes selection set file', async () => {
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token');
    mockCreateDriveClient.mockReturnValue({} as never);
    mockDeleteSelectionSet.mockResolvedValue(true);

    const response = await DELETE(new Request('http://localhost') as never, {
      params: Promise.resolve({ id: 'set-1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('PATCH returns reconnect_required for missing session', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      }) as never,
      { params: Promise.resolve({ id: 'set-1' }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'reconnect_required', message: 'Reconnect required.' },
      error_code: 'reconnect_required',
    });
  });

  it('DELETE returns reconnect_required for missing session', async () => {
    mockGetGoogleSession.mockResolvedValue(null);
    mockGetGoogleAccessToken.mockResolvedValue(null);

    const response = await DELETE(new Request('http://localhost') as never, {
      params: Promise.resolve({ id: 'set-1' }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'reconnect_required', message: 'Reconnect required.' },
      error_code: 'reconnect_required',
    });
  });
});
