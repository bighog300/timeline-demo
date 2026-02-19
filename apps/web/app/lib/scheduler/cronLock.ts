import type { drive_v3 } from 'googleapis';

const LOCK_FILE = 'cron_lock.json';

type CronLock = {
  version: 1;
  holder: string;
  acquiredAtISO: string;
  leaseUntilISO: string;
};

const readLockFile = async (drive: drive_v3.Drive, driveFolderId: string) => {
  const listed = await drive.files.list({
    q: `'${driveFolderId}' in parents and trashed=false and name='${LOCK_FILE}'`,
    pageSize: 1,
    fields: 'files(id)',
  });
  const fileId = listed.data.files?.[0]?.id;
  if (!fileId) return { fileId: null, lock: null as CronLock | null };

  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json' });
  const value = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  if (!value || typeof value !== 'object') return { fileId, lock: null as CronLock | null };

  return { fileId, lock: value as CronLock };
};

const writeLockFile = async (drive: drive_v3.Drive, driveFolderId: string, fileId: string | null, lock: CronLock) => {
  const body = JSON.stringify(lock, null, 2);
  if (!fileId) {
    await drive.files.create({
      requestBody: { name: LOCK_FILE, parents: [driveFolderId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body },
      fields: 'id',
    });
    return;
  }

  await drive.files.update({
    fileId,
    media: { mimeType: 'application/json', body },
    fields: 'id',
  });
};

export const tryAcquireCronLock = async ({
  drive,
  driveFolderId,
  holder,
  leaseMs = 4 * 60_000,
}: {
  drive: drive_v3.Drive;
  driveFolderId: string;
  holder: string;
  leaseMs?: number;
}) => {
  try {
    const now = Date.now();
    const read = await readLockFile(drive, driveFolderId);
    const currentUntil = read.lock?.leaseUntilISO ? Date.parse(read.lock.leaseUntilISO) : 0;
    if (read.lock && Number.isFinite(currentUntil) && currentUntil > now && read.lock.holder !== holder) {
      return { acquired: false as const, reason: 'locked' as const, lock: read.lock };
    }

    const nextLock: CronLock = {
      version: 1,
      holder,
      acquiredAtISO: new Date(now).toISOString(),
      leaseUntilISO: new Date(now + leaseMs).toISOString(),
    };
    await writeLockFile(drive, driveFolderId, read.fileId, nextLock);
    return { acquired: true as const, lock: nextLock };
  } catch {
    return { acquired: false as const, reason: 'error' as const };
  }
};

export const releaseCronLock = async ({ drive, driveFolderId, holder }: { drive: drive_v3.Drive; driveFolderId: string; holder: string }) => {
  try {
    const read = await readLockFile(drive, driveFolderId);
    if (!read.lock || !read.fileId || read.lock.holder !== holder) return;
    const expired: CronLock = {
      ...read.lock,
      leaseUntilISO: new Date(Date.now() - 1000).toISOString(),
    };
    await writeLockFile(drive, driveFolderId, read.fileId, expired);
  } catch {
    // best effort
  }
};

export const readCronLock = async ({ drive, driveFolderId }: { drive: drive_v3.Drive; driveFolderId: string }) => {
  const read = await readLockFile(drive, driveFolderId);
  return read.lock;
};
