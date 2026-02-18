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
}));

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/writeSelectionSetToDrive', () => ({
  writeSelectionSetToDrive: vi.fn(),
}));

vi.mock('../../../../lib/googleRequest', () => ({
  logGoogleError: vi.fn(),
  mapGoogleError: vi.fn(() => ({ status: 500, code: 'internal_error', message: 'boom' })),
}));

import { POST } from './route';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';

const mockSession = vi.mocked(getGoogleSession);
const mockToken = vi.mocked(getGoogleAccessToken);
const mockDrive = vi.mocked(createDriveClient);
const mockWrite = vi.mocked(writeSelectionSetToDrive);

describe('POST /api/timeline/selections/create-from-items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ driveFolderId: 'app-folder' } as never);
    mockToken.mockResolvedValue('token');
    mockDrive.mockReturnValue({} as never);
    mockWrite.mockResolvedValue({ driveFileId: 'new-file', driveWebViewLink: 'https://example.com' } as never);
  });

  it('caps and validates item count', async () => {
    const items = Array.from({ length: 201 }, (_, index) => ({ id: `f-${index}` }));
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Selection', source: 'drive', items }),
    }) as never);

    expect(response.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('creates selection when payload is valid', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        name: 'My Selection',
        source: 'drive',
        items: [{ id: 'd1', name: 'Doc 1', modifiedTime: '2024-01-01T00:00:00.000Z' }],
      }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mockWrite).toHaveBeenCalled();
  });
});
