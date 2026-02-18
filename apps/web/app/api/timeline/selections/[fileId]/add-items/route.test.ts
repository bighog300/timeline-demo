import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@timeline/shared', () => ({
  DriveSelectionSetJsonSchema: z
    .object({
      id: z.string(),
      name: z.string(),
      createdAtISO: z.string(),
      updatedAtISO: z.string(),
      items: z.array(
        z.object({
          source: z.literal('drive'),
          id: z.string(),
          title: z.string().optional(),
          dateISO: z.string().optional(),
        }),
      ),
      version: z.number(),
      driveFolderId: z.string(),
      driveFileId: z.string(),
    })
    .passthrough(),
  SelectionSetItemSchema: z.object({
    source: z.literal('drive'),
    id: z.string(),
    title: z.string().optional(),
    dateISO: z.string().optional(),
  }),
}));

vi.mock('../../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../../lib/googleRequest', () => ({
  logGoogleError: vi.fn(),
  mapGoogleError: vi.fn(() => ({ status: 500, code: 'internal_error', message: 'boom' })),
}));

import { POST } from './route';
import { getGoogleAccessToken, getGoogleSession } from '../../../../../lib/googleAuth';
import { createDriveClient } from '../../../../../lib/googleDrive';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDrive = vi.mocked(createDriveClient);

describe('POST /api/timeline/selections/[fileId]/add-items', () => {
  const getMock = vi.fn();
  const updateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'app-folder' } as never);
    mockToken.mockResolvedValue('token');
    getMock.mockReset();
    updateMock.mockReset();
    mockDrive.mockReturnValue({ files: { get: getMock, update: updateMock } } as never);
  });

  it('enforces ownership by app folder parent', async () => {
    getMock.mockResolvedValueOnce({ data: { id: 'file-1', parents: ['other-folder'] } });

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ source: 'drive', items: [{ id: 'd1' }] }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(403);
  });

  it('merges items with dedupe behavior', async () => {
    getMock
      .mockResolvedValueOnce({ data: { id: 'file-1', name: 'Set', parents: ['app-folder'], webViewLink: '' } })
      .mockResolvedValueOnce({
        data: {
          id: 'set-1',
          name: 'Set',
          createdAtISO: '2024-01-01T00:00:00.000Z',
          updatedAtISO: '2024-01-01T00:00:00.000Z',
          version: 1,
          driveFolderId: 'app-folder',
          driveFileId: 'file-1',
          items: [{ source: 'drive', id: 'd1', title: 'Doc 1', dateISO: '2024-01-01T00:00:00.000Z' }],
        },
      });
    updateMock.mockResolvedValueOnce({ data: { id: 'file-1', name: 'Set', webViewLink: '' } });

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ source: 'drive', items: [{ id: 'd1' }, { id: 'd2', name: 'Doc 2' }] }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    const payload = await response.json() as { added: number; skippedDuplicates: number };

    expect(response.status).toBe(200);
    expect(payload.added).toBe(1);
    expect(payload.skippedDuplicates).toBe(1);
    expect(updateMock).toHaveBeenCalled();
  });
});
