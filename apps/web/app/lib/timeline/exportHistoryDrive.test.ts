import { describe, expect, it, vi } from 'vitest';

import { appendExportHistoryItem, readExportHistory, trimExportHistory, type ExportHistory } from './exportHistoryDrive';

const makeDrive = () => {
  const state: { fileId: string | null; content: unknown } = {
    fileId: null,
    content: null,
  };

  return {
    state,
    drive: {
      files: {
        list: vi.fn(async () => ({
          data: { files: state.fileId ? [{ id: state.fileId }] : [] },
        })),
        get: vi.fn(async () => ({
          data: state.content,
        })),
        create: vi.fn(async ({ media }: { media?: { body?: string } }) => {
          state.fileId = 'exports-file-1';
          state.content = media?.body ? JSON.parse(media.body) : null;
          return { data: { id: state.fileId } };
        }),
        update: vi.fn(async ({ media }: { media?: { body?: string } }) => {
          state.content = media?.body ? JSON.parse(media.body) : null;
          return { data: { id: state.fileId } };
        }),
      },
    },
  };
};

describe('exportHistoryDrive', () => {
  it('creates default history when missing', async () => {
    const mocked = makeDrive();

    const history = await readExportHistory(mocked.drive as never, 'folder-1');

    expect(history.version).toBe(1);
    expect(history.items).toEqual([]);
    expect(mocked.drive.files.create).toHaveBeenCalledTimes(1);
  });

  it('appends and trims to 100 items', async () => {
    const mocked = makeDrive();
    const seed: ExportHistory = {
      version: 1,
      updatedAtISO: '2024-01-01T00:00:00.000Z',
      items: Array.from({ length: 100 }, (_, idx) => ({
        exportId: `exp-${idx}`,
        createdAtISO: `2024-01-01T00:${String(idx).padStart(2, '0')}:00.000Z`,
        format: 'pdf' as const,
        artifactIds: [`file-${idx}`],
        artifactCount: 1,
        source: { viewMode: 'summaries' as const },
        result: { pdf: { filename: 'x.pdf' } },
      })),
    };
    mocked.state.fileId = 'exports-file-1';
    mocked.state.content = seed;

    await appendExportHistoryItem(mocked.drive as never, 'folder-1', {
      exportId: 'exp-new',
      createdAtISO: '2024-02-01T00:00:00.000Z',
      format: 'drive_doc',
      artifactIds: ['file-new'],
      artifactCount: 1,
      source: { viewMode: 'timeline' },
      result: { driveDoc: { docId: 'doc-1', webViewLink: 'https://drive.google.com/doc-1' } },
    });

    const stored = mocked.state.content as ExportHistory;
    expect(stored.items).toHaveLength(100);
    expect(stored.items[0]?.exportId).toBe('exp-1');
    expect(stored.items.at(-1)?.exportId).toBe('exp-new');
  });

  it('dedups by exportId', async () => {
    const mocked = makeDrive();
    mocked.state.fileId = 'exports-file-1';
    mocked.state.content = {
      version: 1,
      updatedAtISO: '2024-01-01T00:00:00.000Z',
      items: [
        {
          exportId: 'exp-dup',
          createdAtISO: '2024-01-01T00:00:00.000Z',
          format: 'pdf',
          artifactIds: ['file-1'],
          artifactCount: 1,
          source: { viewMode: 'summaries' },
          result: { pdf: { filename: 'timeline.pdf' } },
        },
      ],
    };

    await appendExportHistoryItem(mocked.drive as never, 'folder-1', {
      exportId: 'exp-dup',
      createdAtISO: '2024-01-02T00:00:00.000Z',
      format: 'pdf',
      artifactIds: ['file-2'],
      artifactCount: 1,
      source: { viewMode: 'timeline' },
      result: { pdf: { filename: 'other.pdf' } },
    });

    expect(mocked.drive.files.update).not.toHaveBeenCalled();
    const stored = mocked.state.content as ExportHistory;
    expect(stored.items).toHaveLength(1);
  });

  it('trimExportHistory keeps newest entries only', () => {
    const history: ExportHistory = {
      version: 1,
      updatedAtISO: '2024-01-01T00:00:00.000Z',
      items: Array.from({ length: 4 }, (_, idx) => ({
        exportId: `exp-${idx}`,
        createdAtISO: '2024-01-01T00:00:00.000Z',
        format: 'pdf',
        artifactIds: ['file-1'],
        artifactCount: 1,
        source: { viewMode: 'summaries' },
        result: { pdf: { filename: 'timeline.pdf' } },
      })),
    };

    const trimmed = trimExportHistory(history, 2);
    expect(trimmed.items.map((item) => item.exportId)).toEqual(['exp-2', 'exp-3']);
  });
});
