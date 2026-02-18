import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@timeline/shared', () => ({
  SelectionSetItemSchema: z
    .object({
      source: z.union([z.literal('gmail'), z.literal('drive')]),
      id: z.string(),
      title: z.string().optional(),
      dateISO: z.string().optional(),
    })
    .strict(),
  DriveSelectionSetJsonSchema: z
    .object({
      id: z.string(),
      name: z.string(),
      createdAtISO: z.string(),
      updatedAtISO: z.string(),
      items: z.array(
        z
          .object({
            source: z.union([z.literal('gmail'), z.literal('drive')]),
            id: z.string(),
            title: z.string().optional(),
            dateISO: z.string().optional(),
          })
          .strict(),
      ),
      version: z.number(),
      driveFolderId: z.string(),
      driveFileId: z.string(),
    })
    .passthrough(),
}));

vi.mock('../../../../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('../../../../../lib/googleDrive', () => ({
  createDriveClient: vi.fn(),
}));

vi.mock('../../../../../lib/chatContextLoader', () => ({
  loadChatContext: vi.fn(),
}));

vi.mock('../../../../../lib/readSelectionSetFromDrive', () => ({
  readSelectionSetFromDrive: vi.fn(),
}));

vi.mock('../../../../../lib/googleRequest', () => ({
  logGoogleError: vi.fn(),
  mapGoogleError: vi.fn(() => ({ status: 500, code: 'internal_error', message: 'internal_error' })),
}));

import { getGoogleAccessToken, getGoogleSession } from '../../../../../lib/googleAuth';
import { createDriveClient } from '../../../../../lib/googleDrive';
import { loadChatContext } from '../../../../../lib/chatContextLoader';
import { POST } from './route';

const mockGetGoogleSession = vi.mocked(getGoogleSession);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockCreateDriveClient = vi.mocked(createDriveClient);
const mockLoadChatContext = vi.mocked(loadChatContext);

const makeSelection = (items: Array<{ source: 'gmail' | 'drive'; id: string; title?: string; dateISO?: string }>) => ({
  id: 'sel-1',
  name: 'Selection One',
  createdAtISO: '2025-01-01T00:00:00.000Z',
  updatedAtISO: '2025-01-01T00:00:00.000Z',
  version: 1,
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  items,
});

describe('POST /api/timeline/selections/[fileId]/add-from-context', () => {
  const mockDrive = {
    files: {
      get: vi.fn(),
      update: vi.fn(),
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoogleSession.mockResolvedValue({ driveFolderId: 'folder-1' } as never);
    mockGetGoogleAccessToken.mockResolvedValue('token-1');
    mockCreateDriveClient.mockReturnValue(mockDrive);
  });

  it('returns 400 on invalid body', async () => {
    const response = await POST(
      new Request('http://localhost/api/timeline/selections/file-1/add-from-context', {
        method: 'POST',
        body: JSON.stringify({ context: { mode: 'recent' } }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(400);
    expect(mockDrive.files.get).not.toHaveBeenCalled();
  });

  it('returns 404 when target is not found', async () => {
    mockDrive.files.get.mockRejectedValueOnce(new Error('not found'));

    const { mapGoogleError } = await import('../../../../../lib/googleRequest');
    vi.mocked(mapGoogleError).mockReturnValueOnce({
      status: 404,
      code: 'not_found',
      message: 'not found',
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/selections/file-1/add-from-context', {
        method: 'POST',
        body: JSON.stringify({ context: { mode: 'recent', recentCount: 8, sourceFilter: 'all' } }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('returns 403 when target selection is outside app folder', async () => {
    mockDrive.files.get.mockResolvedValueOnce({
      data: { id: 'file-1', parents: ['other-folder'] },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/selections/file-1/add-from-context', {
        method: 'POST',
        body: JSON.stringify({ context: { mode: 'recent', recentCount: 8, sourceFilter: 'all' } }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(403);
    expect(mockLoadChatContext).not.toHaveBeenCalled();
  });

  it('returns 400 when context is empty', async () => {
    mockDrive.files.get.mockResolvedValueOnce({
      data: { id: 'file-1', name: 'Selection One', parents: ['folder-1'], webViewLink: 'https://drive/one' },
    });
    mockDrive.files.get.mockResolvedValueOnce({
      data: makeSelection([{ source: 'drive', id: 'existing-1', title: 'Existing 1' }]),
    });
    mockLoadChatContext.mockResolvedValue({
      items: [],
      key: 'Recent 8 (All)',
      indexMissing: false,
      debug: { usedIndex: true, totalConsidered: 0 },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/selections/file-1/add-from-context', {
        method: 'POST',
        body: JSON.stringify({ context: { mode: 'recent', recentCount: 8, sourceFilter: 'all' } }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toBe('No artifacts in context to add.');
  });

  it('merges, dedupes, caps, and returns added/skipped counts', async () => {
    const existingItems = Array.from({ length: 499 }, (_, idx) => ({
      source: 'drive' as const,
      id: `existing-${idx}`,
      title: `Existing ${idx}`,
      dateISO: `2025-01-01T00:${String(idx % 60).padStart(2, '0')}:00.000Z`,
    }));

    mockDrive.files.get.mockResolvedValueOnce({
      data: { id: 'file-1', name: 'Selection One', parents: ['folder-1'], webViewLink: 'https://drive/one' },
    });
    mockDrive.files.get.mockResolvedValueOnce({
      data: makeSelection(existingItems),
    });

    mockLoadChatContext.mockResolvedValue({
      items: [
        {
          artifactId: 'a-1',
          source: 'drive',
          sourceId: 'existing-1',
          title: 'Updated Existing 1',
          snippet: 's1',
          dateISO: '2025-02-01T00:00:00.000Z',
        },
        {
          artifactId: 'a-2',
          source: 'drive',
          sourceId: 'new-1',
          title: 'New 1',
          snippet: 's2',
          dateISO: '2025-03-01T00:00:00.000Z',
        },
        {
          artifactId: 'a-3',
          source: 'drive',
          sourceId: 'new-1',
          title: 'New 1 duplicate',
          snippet: 's3',
          dateISO: '2025-04-01T00:00:00.000Z',
        },
        {
          artifactId: 'a-4',
          source: 'gmail',
          sourceId: 'new-2',
          title: 'New 2',
          snippet: 's4',
          dateISO: '2025-05-01T00:00:00.000Z',
        },
      ],
      key: 'Recent 8 (All)',
      indexMissing: false,
      debug: { usedIndex: true, totalConsidered: 4 },
    });

    mockDrive.files.update.mockResolvedValue({
      data: { id: 'file-1', name: 'Selection One', webViewLink: 'https://drive/one' },
    });

    const response = await POST(
      new Request('http://localhost/api/timeline/selections/file-1/add-from-context', {
        method: 'POST',
        body: JSON.stringify({ context: { mode: 'recent', recentCount: 8, sourceFilter: 'all' } }),
      }) as never,
      { params: Promise.resolve({ fileId: 'file-1' }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      count: number;
      added: number;
      skippedDuplicates: number;
    };

    expect(payload.count).toBe(500);
    expect(payload.added).toBe(2);
    expect(payload.skippedDuplicates).toBe(2);

    const updatePayload = mockDrive.files.update.mock.calls[0]?.[0] as {
      media: { body: string };
    };
    const updatedSelection = JSON.parse(updatePayload.media.body) as { items: Array<{ source: string; id: string; title?: string }> };
    const keys = new Set(updatedSelection.items.map((item) => `${item.source}:${item.id}`));
    expect(updatedSelection.items).toHaveLength(500);
    expect(keys.size).toBe(500);
    expect(updatedSelection.items.some((item) => item.id === 'existing-1' && item.title === 'Existing 1')).toBe(true);
  });
});
