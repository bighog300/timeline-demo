import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@timeline/shared', () => ({
  DriveSelectionSetJsonSchema: z.object({
    id: z.string(),
    name: z.string(),
    createdAtISO: z.string(),
    updatedAtISO: z.string(),
    items: z.array(z.object({ source: z.literal('drive'), id: z.string(), title: z.string().optional(), dateISO: z.string().optional() })),
    version: z.number(),
    driveFolderId: z.string(),
    driveFileId: z.string(),
  }).passthrough(),
  SelectionSetItemSchema: z.object({ source: z.literal('drive'), id: z.string(), title: z.string().optional(), dateISO: z.string().optional() }),
}));

vi.mock('../../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../../lib/driveBrowseSelection', async () => {
  const { z: localZ } = await import('zod');
  return {
    MIME_GROUP_SCHEMA: localZ.enum(['docs', 'pdf', 'all']),
    SCOPE_SCHEMA: localZ.enum(['app', 'root']),
    resolveDriveSelection: vi.fn(),
  };
});

vi.mock('../../../../../lib/googleDrive', () => ({ createDriveClient: vi.fn() }));
vi.mock('../../../../../lib/googleRequest', () => ({
  logGoogleError: vi.fn(),
  mapGoogleError: vi.fn(() => ({ status: 500, code: 'internal_error', message: 'boom' })),
}));

import { POST } from './route';
import { getGoogleAccessToken, getGoogleSession } from '../../../../../lib/googleAuth';
import { createDriveClient } from '../../../../../lib/googleDrive';
import { resolveDriveSelection } from '../../../../../lib/driveBrowseSelection';

describe('POST /api/timeline/selections/[fileId]/add-from-drive-browse', () => {
  const getMock = vi.fn();
  const updateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGoogleSession).mockResolvedValue({ driveFolderId: 'app-folder' } as never);
    vi.mocked(getGoogleAccessToken).mockResolvedValue('token');
    getMock.mockReset();
    updateMock.mockReset();
    vi.mocked(createDriveClient).mockReturnValue({ files: { get: getMock, update: updateMock } } as never);

    getMock
      .mockResolvedValueOnce({ data: { id: 'sel-1', parents: ['app-folder'], name: 'Selection A' } })
      .mockResolvedValueOnce({ data: {
        id: 'selection-id',
        name: 'Selection A',
        createdAtISO: '2024-01-01T00:00:00.000Z',
        updatedAtISO: '2024-01-01T00:00:00.000Z',
        items: [{ source: 'drive', id: 'existing', title: 'Old', dateISO: '2024-01-02T00:00:00.000Z' }],
        version: 1,
        driveFolderId: 'app-folder',
        driveFileId: 'sel-1',
      } });

    vi.mocked(resolveDriveSelection).mockResolvedValue({
      dryRun: false,
      limit: 500,
      foundFiles: 2,
      truncated: false,
      files: [
        { id: 'new-1', name: 'New 1', mimeType: 'application/pdf', modifiedTime: '2024-01-03T00:00:00.000Z', webViewLink: null },
        { id: 'existing', name: 'Existing', mimeType: 'application/pdf', modifiedTime: '2024-01-04T00:00:00.000Z', webViewLink: null },
      ],
    });
    updateMock.mockResolvedValue({ data: { id: 'sel-1', name: 'Selection A' } });
  });

  it('enforces ownership and merges while skipping duplicates', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ scope: 'root', picked: [{ id: 'folder-1', isFolder: true }], mimeGroup: 'all', limit: 500 }),
    }) as never, { params: Promise.resolve({ fileId: 'sel-1' }) });

    const payload = await response.json() as { added: number; skippedDuplicates: number; count: number };

    expect(response.status).toBe(200);
    expect(payload.added).toBe(1);
    expect(payload.skippedDuplicates).toBe(1);
    expect(payload.count).toBe(2);
    expect(updateMock).toHaveBeenCalled();
  });

  it('rejects selection outside app folder', async () => {
    getMock.mockReset();
    getMock.mockResolvedValueOnce({ data: { id: 'sel-1', parents: ['outside'] } });

    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ scope: 'root', picked: [{ id: 'folder-1', isFolder: true }], mimeGroup: 'all' }),
    }) as never, { params: Promise.resolve({ fileId: 'sel-1' }) });

    expect(response.status).toBe(403);
    expect(resolveDriveSelection).not.toHaveBeenCalled();
  });
});
