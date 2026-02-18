import { describe, expect, it, vi, beforeEach } from 'vitest';
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
          source: z.union([z.literal('gmail'), z.literal('drive')]),
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

import { OutsideFolderError } from '../../../../lib/driveSafety';

vi.mock('../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../lib/chatContextLoader', () => ({
  loadChatContext: vi.fn(),
}));

vi.mock('../../../../lib/writeSelectionSetToDrive', () => ({
  writeSelectionSetToDrive: vi.fn(),
}));

vi.mock('../../../../lib/readSelectionSetFromDrive', () => ({
  readSelectionSetFromDrive: vi.fn(),
}));

vi.mock('../../../../lib/googleRequest', () => ({
  logGoogleError: vi.fn(),
  mapGoogleError: vi.fn(() => ({ status: 500, code: 'internal_error', message: 'internal_error' })),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { loadChatContext } from '../../../../lib/chatContextLoader';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockLoadChatContext = vi.mocked(loadChatContext);
const mockWriteSelectionSetToDrive = vi.mocked(writeSelectionSetToDrive);
const mockReadSelectionSetFromDrive = vi.mocked(readSelectionSetFromDrive);

describe('POST /api/timeline/selections/create-from-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token-1');
    mockCreateDriveClient.mockReturnValue({} as never);
  });

  it('returns 400 on invalid body', async () => {
    const response = await POST(
      new Request('http://localhost/api/timeline/selections/create-from-context', {
        method: 'POST',
        body: JSON.stringify({
          name: 'A',
          context: { mode: 'recent', sourceFilter: 'all' },
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(mockLoadChatContext).not.toHaveBeenCalled();
  });

  it('returns 400 when context has no artifacts', async () => {
    mockLoadChatContext.mockResolvedValue({
      items: [],
      key: 'Recent 8 (All)',
      indexMissing: false,
      debug: { usedIndex: true, totalConsidered: 0 },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/selections/create-from-context', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Context Save',
          context: { mode: 'recent', recentCount: 8, sourceFilter: 'all' },
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toBe('No artifacts in context to save.');
  });

  it('creates a selection with dedupe and 200 item cap', async () => {
    const items = Array.from({ length: 205 }, (_, idx) => ({
      artifactId: `artifact-${idx}`,
      source: 'drive' as const,
      sourceId: `doc-${idx}`,
      title: `Doc ${idx}`,
      snippet: 'summary',
      dateISO: new Date(Date.UTC(2025, 0, 1, 0, idx, 0)).toISOString(),
    }));
    items.push({
      artifactId: 'artifact-dup',
      source: 'drive',
      sourceId: 'doc-3',
      title: 'Doc 3 duplicate',
      snippet: 'duplicate',
      dateISO: new Date(Date.UTC(2025, 0, 2)).toISOString(),
    });

    mockLoadChatContext.mockResolvedValue({
      items,
      key: 'Recent 50 (All)',
      indexMissing: false,
      debug: { usedIndex: true, totalConsidered: items.length },
    });
    mockWriteSelectionSetToDrive.mockResolvedValue({
      driveFileId: 'new-file-id',
      driveWebViewLink: 'https://drive.google.com/file/new-file-id',
      modifiedTime: '2025-01-02T00:00:00.000Z',
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/selections/create-from-context', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Recent Context',
          context: { mode: 'recent', recentCount: 50, sourceFilter: 'all' },
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(mockWriteSelectionSetToDrive).toHaveBeenCalledTimes(1);

    const writePayload = mockWriteSelectionSetToDrive.mock.calls[0]?.[2];
    expect(writePayload?.items).toHaveLength(200);
    const uniqueKeys = new Set(
      (writePayload?.items ?? []).map((item) => `${item.source}:${item.id}`),
    );
    expect(uniqueKeys.size).toBe(200);

    const json = (await response.json()) as { fileId: string; count: number };
    expect(json.fileId).toBe('new-file-id');
    expect(json.count).toBe(200);
  });

  it('returns 403 for selection set folder mismatch', async () => {
    mockReadSelectionSetFromDrive.mockRejectedValue(new OutsideFolderError('set-1'));

    const response = await POST(
      new Request('http://localhost/api/timeline/selections/create-from-context', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Selection context',
          context: { mode: 'selection_set', selectionSetId: 'set-1', sourceFilter: 'all' },
        }),
      }) as never,
    );

    expect(response.status).toBe(403);
    expect(mockLoadChatContext).not.toHaveBeenCalled();
  });
});
