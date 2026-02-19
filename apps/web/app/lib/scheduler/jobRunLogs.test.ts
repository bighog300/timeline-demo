import { describe, expect, it } from 'vitest';

import { appendJobRun, readJobRunsTail } from './jobRunLogs';

const createMockDrive = () => {
  const files = new Map<string, { id: string; body: string }>();
  let idCounter = 0;

  const findByName = (name: string) => files.get(name);

  return {
    __files: files,
    files: {
      list: async ({ q }: { q?: string }) => {
        const match = q?.match(/name='([^']+)'/);
        const name = match?.[1] ?? '';
        const found = findByName(name);
        return { data: { files: found ? [{ id: found.id }] : [] } };
      },
      get: async ({ fileId }: { fileId: string }) => {
        const found = [...files.values()].find((item) => item.id === fileId);
        return { data: found?.body ?? '' };
      },
      create: async ({ requestBody, media }: { requestBody?: { name?: string }; media?: { body?: string } }) => {
        const name = requestBody?.name ?? `file-${idCounter++}`;
        files.set(name, { id: `id-${idCounter++}`, body: media?.body ?? '' });
        return { data: { id: files.get(name)?.id } };
      },
      update: async ({ fileId, media }: { fileId: string; media?: { body?: string } }) => {
        const pair = [...files.entries()].find(([, item]) => item.id === fileId);
        if (pair) {
          const [name] = pair;
          files.set(name, { id: fileId, body: media?.body ?? '' });
        }
        return { data: { id: fileId } };
      },
    },
  };
};

describe('jobRunLogs', () => {
  it('writes to monthly file', async () => {
    const drive = createMockDrive();
    await appendJobRun({ drive: drive as never, driveFolderId: 'folder-1', now: new Date('2026-02-01T00:00:00Z'), entry: { id: 1 } });

    expect(drive.__files.has('job_runs_202602.jsonl')).toBe(true);
    expect(drive.__files.has('job_runs_tail.jsonl')).toBe(true);
  });

  it('keeps tail bounded', async () => {
    const drive = createMockDrive();
    for (let index = 0; index < 6; index += 1) {
      await appendJobRun({ drive: drive as never, driveFolderId: 'folder-1', now: new Date('2026-02-01T00:00:00Z'), maxTailLines: 3, entry: { index } });
    }

    const tail = await readJobRunsTail({ drive: drive as never, driveFolderId: 'folder-1', maxLines: 10 });
    expect(tail).toHaveLength(3);
    expect(tail[0]).toMatchObject({ index: 3 });
    expect(tail[2]).toMatchObject({ index: 5 });
  });

  it('resets oversized tail safely', async () => {
    const drive = createMockDrive();
    drive.__files.set('job_runs_tail.jsonl', { id: 'tail-id', body: 'x'.repeat(600_000) });

    await appendJobRun({ drive: drive as never, driveFolderId: 'folder-1', now: new Date('2026-02-01T00:00:00Z'), entry: { safe: true } });

    const tail = await readJobRunsTail({ drive: drive as never, driveFolderId: 'folder-1', maxLines: 10 });
    expect(tail).toEqual([{ safe: true }]);
  });
});
