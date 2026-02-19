import type { drive_v3 } from 'googleapis';

const MONTHLY_PREFIX = 'job_runs_';
const MONTHLY_SUFFIX = '.jsonl';
const TAIL_FILE = 'job_runs_tail.jsonl';
const LEGACY_FILE = 'job_runs.jsonl';
const DEFAULT_MAX_TAIL_LINES = 300;
const MAX_TAIL_BYTES_GUARD = 512 * 1024;

const parseJsonLines = (value: string) => value
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });

const fileForMonth = (date: Date) => `${MONTHLY_PREFIX}${date.toISOString().slice(0, 7).replace('-', '')}${MONTHLY_SUFFIX}`;

const findFileId = async (drive: drive_v3.Drive, folderId: string, name: string) => {
  const listed = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name='${name}'`,
    pageSize: 1,
    fields: 'files(id)',
  });

  return listed.data.files?.[0]?.id;
};

const upsertTextFile = async (drive: drive_v3.Drive, folderId: string, name: string, body: string) => {
  const existing = await findFileId(drive, folderId, name);
  if (!existing) {
    await drive.files.create({
      requestBody: { name, parents: [folderId], mimeType: 'application/x-ndjson' },
      media: { mimeType: 'application/x-ndjson', body },
      fields: 'id',
    });
    return;
  }

  await drive.files.update({
    fileId: existing,
    media: { mimeType: 'application/x-ndjson', body },
    fields: 'id',
  });
};

const appendToFile = async (drive: drive_v3.Drive, folderId: string, name: string, line: string) => {
  const fileId = await findFileId(drive, folderId, name);
  if (!fileId) {
    await drive.files.create({
      requestBody: { name, parents: [folderId], mimeType: 'application/x-ndjson' },
      media: { mimeType: 'application/x-ndjson', body: line },
      fields: 'id',
    });
    return;
  }

  const existing = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const next = `${typeof existing.data === 'string' ? existing.data : ''}${line}`;
  await drive.files.update({
    fileId,
    media: { mimeType: 'application/x-ndjson', body: next },
    fields: 'id',
  });
};

export const appendJobRun = async ({
  drive,
  driveFolderId,
  entry,
  now = new Date(),
  maxTailLines = DEFAULT_MAX_TAIL_LINES,
}: {
  drive: drive_v3.Drive;
  driveFolderId: string;
  entry: Record<string, unknown>;
  now?: Date;
  maxTailLines?: number;
}) => {
  const line = `${JSON.stringify(entry)}\n`;
  await appendToFile(drive, driveFolderId, fileForMonth(now), line);

  const tailFileId = await findFileId(drive, driveFolderId, TAIL_FILE);
  if (!tailFileId) {
    await upsertTextFile(drive, driveFolderId, TAIL_FILE, line);
    return;
  }

  const existing = await drive.files.get({ fileId: tailFileId, alt: 'media' }, { responseType: 'text' });
  const existingBody = typeof existing.data === 'string' ? existing.data : '';
  if (existingBody.length > MAX_TAIL_BYTES_GUARD) {
    await drive.files.update({
      fileId: tailFileId,
      media: { mimeType: 'application/x-ndjson', body: line },
      fields: 'id',
    });
    return;
  }

  const nextLines = existingBody.split('\n').map((item) => item.trim()).filter(Boolean);
  nextLines.push(JSON.stringify(entry));
  const bounded = nextLines.slice(-maxTailLines).join('\n');
  await drive.files.update({
    fileId: tailFileId,
    media: { mimeType: 'application/x-ndjson', body: `${bounded}${bounded ? '\n' : ''}` },
    fields: 'id',
  });
};

export const readJobRunsTail = async ({
  drive,
  driveFolderId,
  maxLines = 300,
}: {
  drive: drive_v3.Drive;
  driveFolderId: string;
  maxLines?: number;
}) => {
  const fileId = await findFileId(drive, driveFolderId, TAIL_FILE);
  if (!fileId) return [] as Array<Record<string, unknown>>;
  const data = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const parsed = parseJsonLines(typeof data.data === 'string' ? data.data : '');
  return parsed.slice(-maxLines);
};

export const readJobRunsForMonth = async ({
  drive,
  driveFolderId,
  yyyymm,
  maxLines = 500,
}: {
  drive: drive_v3.Drive;
  driveFolderId: string;
  yyyymm: string;
  maxLines?: number;
}) => {
  const fileId = await findFileId(drive, driveFolderId, `${MONTHLY_PREFIX}${yyyymm}${MONTHLY_SUFFIX}`);
  if (!fileId) return [] as Array<Record<string, unknown>>;
  const data = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const parsed = parseJsonLines(typeof data.data === 'string' ? data.data : '');
  return parsed.slice(-maxLines);
};

export const readLegacyJobRuns = async ({ drive, driveFolderId, maxLines = 500 }: { drive: drive_v3.Drive; driveFolderId: string; maxLines?: number }) => {
  const fileId = await findFileId(drive, driveFolderId, LEGACY_FILE);
  if (!fileId) return [] as Array<Record<string, unknown>>;
  const data = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const parsed = parseJsonLines(typeof data.data === 'string' ? data.data : '');
  return parsed.slice(-maxLines);
};
