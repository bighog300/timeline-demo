import { describe, expect, it, vi, beforeEach } from 'vitest';

import { loadChatContext } from './chatContextLoader';

vi.mock('./indexDrive', () => ({
  findIndexFile: vi.fn(),
  readIndexFile: vi.fn(),
}));

import { findIndexFile, readIndexFile } from './indexDrive';

const mockFindIndexFile = vi.mocked(findIndexFile);
const mockReadIndexFile = vi.mocked(readIndexFile);

const makeDrive = () => ({
  files: {
    get: vi.fn(),
    list: vi.fn(),
  },
});

describe('chatContextLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recent mode returns N filtered items', async () => {
    const drive = makeDrive();
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({
      summaries: [
        { driveFileId: 's1', source: 'gmail', sourceId: 'g1', title: 'G1', updatedAtISO: '2024-01-02T00:00:00.000Z' },
        { driveFileId: 's2', source: 'drive', sourceId: 'd1', title: 'D1', updatedAtISO: '2024-01-03T00:00:00.000Z' },
      ],
    } as never);
    (drive.files.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { type: 'summary', status: 'complete', id: 'a', artifactId: 'a', source: 'drive', sourceId: 'd1', title: 'Drive one', createdAtISO: '2024-01-01T00:00:00.000Z', summary: 'sum', highlights: [], driveFolderId: 'f', driveFileId: 's2', model: 'm', version: 1, updatedAtISO: '2024-01-01T00:00:00.000Z', meta: { driveFileId: 's2', driveFolderId: 'f', source: 'drive', sourceId: 'd1', model: 'm', version: 1 } } },
      );

    const result = await loadChatContext({
      drive: drive as never,
      driveFolderId: 'folder-1',
      selection: { mode: 'recent', recentCount: 8, sourceFilter: 'drive' },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.source).toBe('drive');
  });

  it('selection_set mode resolves items', async () => {
    const drive = makeDrive();
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({
      summaries: [{ driveFileId: 'sum-1', source: 'gmail', sourceId: 'm1', title: 'Mail', updatedAtISO: '2024-01-03T00:00:00.000Z' }],
    } as never);
    (drive.files.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { id: 'set-file', name: 'Case set', createdAtISO: '2024-01-01T00:00:00.000Z', updatedAtISO: '2024-01-01T00:00:00.000Z', items: [{ source: 'gmail', id: 'm1' }], version: 1, driveFolderId: 'f', driveFileId: 'set-file' } })
      .mockResolvedValueOnce({ data: { type: 'summary', status: 'complete', id: 'x', artifactId: 'x', source: 'gmail', sourceId: 'm1', title: 'Mail summary', createdAtISO: '2024-01-01T00:00:00.000Z', summary: 'sum', highlights: [], driveFolderId: 'f', driveFileId: 'sum-1', model: 'm', version: 1, updatedAtISO: '2024-01-01T00:00:00.000Z', meta: { driveFileId: 'sum-1', driveFolderId: 'f', source: 'gmail', sourceId: 'm1', model: 'm', version: 1 } } });

    const result = await loadChatContext({
      drive: drive as never,
      driveFolderId: 'folder-1',
      selection: { mode: 'selection_set', recentCount: 8, sourceFilter: 'all', selectionSetId: 'set-file' },
    });

    expect(result.items).toHaveLength(1);
    expect(result.selectionSetName).toBe('Case set');
  });

  it('empty selection set returns empty context', async () => {
    const drive = makeDrive();
    mockFindIndexFile.mockResolvedValue({ id: 'index-1' } as never);
    mockReadIndexFile.mockResolvedValue({ summaries: [] } as never);
    (drive.files.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { id: 'set-file', name: 'Empty set', createdAtISO: '2024-01-01T00:00:00.000Z', updatedAtISO: '2024-01-01T00:00:00.000Z', items: [], version: 1, driveFolderId: 'f', driveFileId: 'set-file' },
    });

    const result = await loadChatContext({
      drive: drive as never,
      driveFolderId: 'folder-1',
      selection: { mode: 'selection_set', recentCount: 8, sourceFilter: 'all', selectionSetId: 'set-file' },
    });

    expect(result.items).toEqual([]);
  });
});
