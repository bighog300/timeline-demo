import { NotificationCircuitBreakerSchema, type NotificationCircuitBreakerState } from '@timeline/shared';
import type { drive_v3 } from 'googleapis';

const FILE_NAME = 'notification_circuit_breakers.json';
const MESSAGE_MAX = 200;

type TargetInput = {
  channel: 'email' | 'slack' | 'webhook';
  targetKey?: string;
  recipientKey?: string;
};

type LastError = {
  status?: number;
  code?: string;
  message: string;
};

type MutableState = NotificationCircuitBreakerState;

const toKey = ({ channel, targetKey, recipientKey }: TargetInput) => `${channel}:${channel === 'email' ? (recipientKey ?? '') : (targetKey ?? '')}`;

const sanitizeError = (error: LastError): LastError => ({
  ...(typeof error.status === 'number' ? { status: error.status } : {}),
  ...(error.code ? { code: error.code.slice(0, 60) } : {}),
  message: error.message.slice(0, MESSAGE_MAX),
});

const getFileId = async (drive: drive_v3.Drive, driveFolderId: string) => {
  const listed = await drive.files.list({
    q: `'${driveFolderId}' in parents and trashed=false and name='${FILE_NAME}'`,
    pageSize: 1,
    fields: 'files(id)',
  });
  return listed.data.files?.[0]?.id;
};

export const emptyCircuitBreakers = (): MutableState => ({
  version: 1,
  updatedAtISO: new Date(0).toISOString(),
  targets: [],
});

export const loadCircuitBreakers = async (drive: drive_v3.Drive, driveFolderId: string): Promise<MutableState> => {
  const fileId = await getFileId(drive, driveFolderId);
  if (!fileId) return emptyCircuitBreakers();

  try {
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    const parsed = JSON.parse(typeof response.data === 'string' ? response.data : '{}');
    return NotificationCircuitBreakerSchema.parse(parsed);
  } catch {
    return emptyCircuitBreakers();
  }
};

export const saveCircuitBreakers = async (drive: drive_v3.Drive, driveFolderId: string, state: MutableState) => {
  const next = NotificationCircuitBreakerSchema.parse({ ...state, updatedAtISO: new Date().toISOString() });
  const body = JSON.stringify(next, null, 2);
  const existing = await getFileId(drive, driveFolderId);

  if (!existing) {
    await drive.files.create({
      requestBody: { name: FILE_NAME, parents: [driveFolderId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body },
      fields: 'id',
    });
    return;
  }

  await drive.files.update({
    fileId: existing,
    media: { mimeType: 'application/json', body },
    fields: 'id',
  });
};

const getOrCreate = (state: MutableState, target: TargetInput) => {
  const key = toKey(target);
  const existing = state.targets.find((item) => toKey(item) === key);
  if (existing) return existing;

  const created: MutableState['targets'][number] = {
    channel: target.channel,
    ...(target.targetKey ? { targetKey: target.targetKey } : {}),
    ...(target.recipientKey ? { recipientKey: target.recipientKey } : {}),
    state: 'open',
    failureCount: 0,
  };
  state.targets.push(created);
  return created;
};

const isWithinMs = (fromISO: string | undefined, nowMs: number, windowMs: number) => (fromISO ? nowMs - Date.parse(fromISO) <= windowMs : false);

const maybeMuteTarget = (entry: MutableState['targets'][number], now: Date) => {
  const nowMs = now.getTime();
  const in30m = isWithinMs(entry.firstFailureAtISO, nowMs, 30 * 60 * 1000);
  const in6h = isWithinMs(entry.firstFailureAtISO, nowMs, 6 * 60 * 60 * 1000);

  let durationMs = 0;
  if (entry.failureCount >= 6 && in6h) durationMs = 6 * 60 * 60 * 1000;
  else if (entry.failureCount >= 3 && in30m) durationMs = 30 * 60 * 1000;

  if (!durationMs) return;
  entry.state = 'muted';
  entry.mutedUntilISO = new Date(nowMs + durationMs).toISOString();
};

export const getCircuitState = (state: MutableState, target: TargetInput, now = new Date()) => {
  const found = state.targets.find((item) => toKey(item) === toKey(target));
  if (!found || found.state !== 'muted') return { muted: false as const };

  const mutedUntil = found.mutedUntilISO;
  if (!mutedUntil || Date.parse(mutedUntil) <= now.getTime()) {
    found.state = 'open';
    found.mutedUntilISO = undefined;
    return { muted: false as const };
  }

  return {
    muted: true as const,
    mutedUntilISO: mutedUntil,
    reason: found.lastError?.message ?? 'muted_due_to_failures',
  };
};

export const recordSendFailure = ({ state, target, error, now = new Date() }: { state: MutableState; target: TargetInput; error: LastError; now?: Date }) => {
  const entry = getOrCreate(state, target);
  entry.failureCount += 1;
  if (!entry.firstFailureAtISO) entry.firstFailureAtISO = now.toISOString();
  entry.lastFailureAtISO = now.toISOString();
  entry.lastError = sanitizeError(error);
  maybeMuteTarget(entry, now);
};

export const recordSendSuccess = ({ state, target }: { state: MutableState; target: TargetInput }) => {
  const entry = getOrCreate(state, target);
  entry.state = 'open';
  entry.failureCount = 0;
  entry.firstFailureAtISO = undefined;
  entry.lastFailureAtISO = undefined;
  entry.mutedUntilISO = undefined;
  entry.lastError = undefined;
};

export const unmuteTarget = (state: MutableState, target: TargetInput) => {
  const entry = getOrCreate(state, target);
  entry.state = 'open';
  entry.failureCount = 0;
  entry.firstFailureAtISO = undefined;
  entry.lastFailureAtISO = undefined;
  entry.mutedUntilISO = undefined;
};
