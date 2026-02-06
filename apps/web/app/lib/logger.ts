import { createHash, randomUUID } from 'crypto';

export type LogContext = {
  requestId: string;
  route: string;
  userHint?: string;
};

const MAX_STRING_LENGTH = 500;

const truncate = (value: string) =>
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;

const redactString = (value: string) => {
  let sanitized = value;
  sanitized = sanitized.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '[redacted-email]',
  );
  sanitized = sanitized.replace(/ya29\.[\w-]+/gi, '[redacted-token]');
  sanitized = sanitized.replace(
    /\beyJ[a-zA-Z0-9_-]+?\.[a-zA-Z0-9_-]+?\.[a-zA-Z0-9_-]+\b/g,
    '[redacted-token]',
  );
  sanitized = sanitized.replace(/(access_token|refresh_token|id_token)=([^&\s]+)/gi, '$1=[redacted]');
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
  sanitized = sanitized.replace(/cookie=([^;\s]+)/gi, 'cookie=[redacted]');
  return truncate(sanitized);
};

const redactValue = (value: unknown, depth = 0): unknown => {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth > 2) {
      return `[array:${value.length}]`;
    }
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    if (depth > 2) {
      return '[object]';
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, redactValue(val, depth + 1)]),
    );
  }

  return truncate(String(value));
};

export const redact = (value: unknown) => redactValue(value);

export const safeError = (error: unknown): {
  name: string;
  message: string;
  code?: string | number;
  status?: number;
} => {
  if (error instanceof Error) {
    const enriched = error as Error & { code?: string | number; status?: number };
    return {
      name: error.name,
      message: redactString(error.message),
      ...(enriched.code === undefined ? {} : { code: enriched.code }),
      ...(enriched.status === undefined ? {} : { status: enriched.status }),
    };
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : 'Error';
    const message =
      typeof record.message === 'string'
        ? redactString(record.message)
        : redactString(String(error));
    const code =
      typeof record.code === 'string' || typeof record.code === 'number'
        ? record.code
        : undefined;
    const status = typeof record.status === 'number' ? record.status : undefined;
    return {
      name,
      message,
      ...(code === undefined ? {} : { code }),
      ...(status === undefined ? {} : { status }),
    };
  }

  return { name: 'Error', message: redactString(String(error)) };
};

const logLine = (
  level: 'info' | 'warn' | 'error',
  ctx: LogContext,
  message: string,
  fields?: Record<string, unknown>,
) => {
  const payload = {
    level,
    ts: new Date().toISOString(),
    requestId: ctx.requestId,
    route: ctx.route,
    msg: message,
    ...(ctx.userHint ? { userHint: ctx.userHint } : {}),
    ...(fields ? (redactValue(fields) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(payload);
  if (level === 'info') {
    console.log(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.error(line);
  }
};

export const logInfo = (ctx: LogContext, message: string, fields?: Record<string, unknown>) =>
  logLine('info', ctx, message, fields);

export const logWarn = (ctx: LogContext, message: string, fields?: Record<string, unknown>) =>
  logLine('warn', ctx, message, fields);

export const logError = (ctx: LogContext, message: string, fields?: Record<string, unknown>) =>
  logLine('error', ctx, message, fields);

export const time = async <T>(
  ctx: LogContext,
  label: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const durationMs = Date.now() - start;
    logInfo(ctx, 'timing', { label, durationMs });
  }
};

export const getRequestId = (req: Request): string => {
  const headerId = req.headers.get('x-request-id');
  if (headerId) {
    return headerId.slice(0, 40);
  }
  try {
    return randomUUID().split('-')[0];
  } catch {
    return Math.random().toString(16).slice(2, 10);
  }
};

export const hashUserHint = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 12);
