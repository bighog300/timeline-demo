export type RetryableError = {
  kind: 'http' | 'timeout' | 'network';
  status?: number;
  code?: string;
  message: string;
};

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxTotalMs?: number;
  jitter?: boolean;
  isRetryable?: (error: RetryableError) => boolean;
  mapError?: (error: unknown) => RetryableError;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultMapError = (error: unknown): RetryableError => {
  if (typeof error === 'object' && error && 'kind' in error) {
    const value = error as RetryableError;
    if (value.kind === 'http' || value.kind === 'timeout' || value.kind === 'network') {
      return value;
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'timeout', message: error.message || 'timeout' };
  }
  if (error instanceof Error) {
    return { kind: 'network', message: error.message || 'network_error' };
  }
  return { kind: 'network', message: 'network_error' };
};

export const defaultIsRetryableError = (error: RetryableError) => {
  if (error.kind === 'timeout' || error.kind === 'network') return true;
  if (error.kind === 'http') {
    if (error.status === 429) return true;
    return typeof error.status === 'number' ? error.status >= 500 : false;
  }
  return false;
};

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: RetryableError; attempts: number }> {
  const maxAttempts = Math.min(Math.max(opts.maxAttempts ?? 3, 1), 5);
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 2000;
  const maxTotalMs = opts.maxTotalMs ?? 4500;
  const jitter = opts.jitter ?? true;
  const isRetryable = opts.isRetryable ?? defaultIsRetryableError;
  const mapError = opts.mapError ?? defaultMapError;

  const started = Date.now();
  let lastError: RetryableError = { kind: 'network', message: 'retry_failed' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await fn(attempt);
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      lastError = mapError(error);
      const shouldRetry = attempt < maxAttempts && isRetryable(lastError);
      if (!shouldRetry) {
        return { ok: false, error: lastError, attempts: attempt };
      }

      const expDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const factor = jitter ? (0.5 + Math.random()) : 1;
      const nextDelay = Math.max(0, Math.floor(expDelay * factor));
      const elapsed = Date.now() - started;
      if (elapsed + nextDelay > maxTotalMs) {
        return { ok: false, error: lastError, attempts: attempt };
      }
      if (nextDelay > 0) await sleep(nextDelay);
    }
  }

  return { ok: false, error: lastError, attempts: maxAttempts };
}
