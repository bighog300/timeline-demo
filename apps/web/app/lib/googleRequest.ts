import type { ApiErrorCode } from './apiErrors';
import type { LogContext } from './logger';
import { logError, logWarn, safeError } from './logger';

type RetryOptions = {
  requestName?: string;
  signal?: AbortSignal;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  ctx?: LogContext;
};

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
export const DEFAULT_GOOGLE_TIMEOUT_MS = 8000;

class TimeoutError extends Error {
  code: ApiErrorCode;

  constructor(message = 'Request timed out', code: ApiErrorCode = 'upstream_timeout') {
    super(message);
    this.name = 'TimeoutError';
    this.code = code;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => resolve(), ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }
  });

const getRetryAfterMs = (value?: string | number | null, maxDelayMs = 2000) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'number') {
    return Math.min(value * 1000, maxDelayMs);
  }

  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.min(seconds * 1000, maxDelayMs);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delay = dateMs - Date.now();
    if (delay > 0) {
      return Math.min(delay, maxDelayMs);
    }
  }

  return null;
};

const statusFromError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if ('response' in error) {
    const response = (error as { response?: { status?: number } }).response;
    return response?.status;
  }

  return undefined;
};

const retryAfterFromError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return null;
  }

  if ('response' in error) {
    const response = (error as { response?: { headers?: Record<string, string | number> } }).response;
    const headers = response?.headers;
    if (headers) {
      return headers['retry-after'] ?? headers['Retry-After'];
    }
  }

  return null;
};

export const withTimeout = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  code: ApiErrorCode = 'upstream_timeout',
  signal?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TimeoutError('Request timed out', code);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const withRetry = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> => {
  const {
    signal,
    maxAttempts = 4,
    baseDelayMs = 250,
    maxDelayMs = 2000,
    factor = 2,
    ctx,
  } = opts;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      return await fn(signal ?? new AbortController().signal);
    } catch (error) {
      lastError = error;
      const status = statusFromError(error);
      const isRetryable = typeof status === 'number' && TRANSIENT_STATUSES.has(status);

      if (!isRetryable || attempt >= maxAttempts) {
        throw error;
      }

      const retryAfterHeader = retryAfterFromError(error);
      const retryAfterMs = getRetryAfterMs(retryAfterHeader, maxDelayMs);
      const baseDelay = Math.min(baseDelayMs * factor ** (attempt - 1), maxDelayMs);
      const jitter = baseDelay * (0.5 + Math.random());
      const delay = Math.min(retryAfterMs ?? jitter, maxDelayMs);

      const statusClass =
        status === 429 ? '429' : typeof status === 'number' && status >= 500 ? '5xx' : 'unknown';
      if (ctx) {
        logWarn(ctx, 'google_retry', {
          attempt,
          maxAttempts,
          status,
          statusClass,
          backoffMs: Math.round(delay),
        });
      } else {
        console.warn('Google retry', {
          attempt,
          maxAttempts,
          status,
          statusClass,
          backoffMs: Math.round(delay),
        });
      }

      await sleep(delay, signal);
    }
  }

  throw lastError;
};

export const mapGoogleError = (
  error: unknown,
  requestName: string,
): { status: number; code: ApiErrorCode; message: string; details?: unknown; logMessage: string } => {
  const status = statusFromError(error);
  const message = error instanceof Error ? error.message : 'unknown_error';

  if (error instanceof TimeoutError) {
    return {
      status: 504,
      code: 'upstream_timeout',
      message: 'Google request timed out. Please retry.',
      details: { request: requestName },
      logMessage: message,
    };
  }

  if (status === 429) {
    return {
      status: 429,
      code: 'rate_limited',
      message: 'Too many requests. Try again in a moment.',
      details: { request: requestName, status },
      logMessage: message,
    };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      status: 502,
      code: 'upstream_error',
      message: 'Google returned an error. Please retry.',
      details: { request: requestName, status },
      logMessage: message,
    };
  }

  return {
    status: 502,
    code: 'upstream_error',
    message: 'Google returned an error. Please retry.',
    details: { request: requestName, status },
    logMessage: message,
  };
};

export const logGoogleError = (error: unknown, requestName: string, ctx?: LogContext) => {
  const status = statusFromError(error);
  if (ctx) {
    logError(ctx, 'google_request_failed', {
      request: requestName,
      status,
      error: safeError(error),
    });
  } else {
    const shortMessage = error instanceof Error ? error.message.slice(0, 120) : 'unknown_error';
    console.warn('Google API request failed', { request: requestName, status, message: shortMessage });
  }
};
