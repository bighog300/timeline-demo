import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@timeline/shared', () => ({
  DriveSelectionSetJsonSchema: z.object({
    id: z.string(),
    name: z.string(),
    createdAtISO: z.string(),
    updatedAtISO: z.string(),
    items: z.array(z.object({ source: z.literal('drive'), id: z.string(), title: z.string(), dateISO: z.string() })),
    version: z.number(),
    driveFolderId: z.string(),
    driveFileId: z.string(),
  }).passthrough(),
  SelectionSetItemSchema: z.object({ source: z.literal('drive'), id: z.string(), title: z.string(), dateISO: z.string() }),
}));

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/driveBrowseSelection', async () => {
  const { z: localZ } = await import('zod');
  return {
    MIME_GROUP_SCHEMA: localZ.enum(['docs', 'pdf', 'all']),
    SCOPE_SCHEMA: localZ.enum(['app', 'root']),
    resolveDriveSelection: vi.fn(),
  };
});

vi.mock('../../../../lib/googleDrive', () => ({ createDriveClient: vi.fn() }));
vi.mock('../../../../lib/writeSelectionSetToDrive', () => ({ writeSelectionSetToDrive: vi.fn() }));
vi.mock('../../../../lib/googleRequest', () => ({
  logGoogleError: vi.fn(),
  mapGoogleError: vi.fn(() => ({ status: 500, code: 'internal_error', message: 'boom' })),
}));

import { POST } from './route';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { resolveDriveSelection } from '../../../../lib/driveBrowseSelection';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';

describe('POST /api/timeline/selections/create-from-drive-browse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGoogleSession).mockResolvedValue({ driveFolderId: 'app-folder' } as never);
    vi.mocked(getGoogleAccessToken).mockResolvedValue('token');
    vi.mocked(resolveDriveSelection).mockResolvedValue({
      dryRun: false,
      limit: 2,
      foundFiles: 2,
      truncated: true,
      files: [
        { id: 'f1', name: 'Doc 1', mimeType: 'application/pdf', modifiedTime: '2024-01-01T00:00:00.000Z', webViewLink: null },
        { id: 'f2', name: 'Doc 2', mimeType: 'application/pdf', modifiedTime: '2024-01-02T00:00:00.000Z', webViewLink: null },
      ],
    });
    vi.mocked(writeSelectionSetToDrive).mockResolvedValue({ driveFileId: 'sel-1' } as never);
  });

  it('creates selection from resolved browse items and returns truncation', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: 'From Browse', scope: 'root', picked: [{ id: 'folder-1', isFolder: true }], mimeGroup: 'all', limit: 200 }),
    }) as never);

    const payload = await response.json() as { fileId: string; count: number; truncated: boolean };
    expect(response.status).toBe(200);
    expect(payload.fileId).toBe('sel-1');
    expect(payload.count).toBe(2);
    expect(payload.truncated).toBe(true);
    expect(resolveDriveSelection).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, limit: 200 }));
    expect(writeSelectionSetToDrive).toHaveBeenCalled();
  });
});
