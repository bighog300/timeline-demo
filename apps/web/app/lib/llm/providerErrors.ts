import type { LLMProviderName } from './types';

export type ProviderErrorCode =
  | 'invalid_request'
  | 'not_configured'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'upstream_timeout'
  | 'upstream_error'
  | 'bad_output';

type ProviderErrorDetails = {
  providerStatus?: number;
  providerCode?: string;
  providerMessage?: string;
  [key: string]: unknown;
};

type ProviderErrorOptions = {
  code: ProviderErrorCode;
  status: number;
  provider: LLMProviderName | 'timeline';
  message: string;
  retryAfterSec?: number;
  details?: ProviderErrorDetails;
};

export class ProviderError extends Error {
  name = 'ProviderError';
  code: ProviderErrorCode;
  status: number;
  provider: LLMProviderName | 'timeline';
  retryAfterSec?: number;
  details?: ProviderErrorDetails;

  constructor(options: ProviderErrorOptions) {
    super(options.message);
    this.code = options.code;
    this.status = options.status;
    this.provider = options.provider;
    this.retryAfterSec = options.retryAfterSec;
    this.details = options.details;
  }
}

const MAX_SAFE_MESSAGE_LENGTH = 200;

const truncateSafe = (value: string) => value.trim().slice(0, MAX_SAFE_MESSAGE_LENGTH);

const extractProviderMessage = (responseJson?: unknown, responseText?: string) => {
  if (responseJson && typeof responseJson === 'object') {
    const record = responseJson as Record<string, unknown>;
    const direct = typeof record.message === 'string' ? record.message : null;
    if (direct) {
      return truncateSafe(direct);
    }

    const nestedError = record.error;
    if (nestedError && typeof nestedError === 'object') {
      const nestedRecord = nestedError as Record<string, unknown>;
      const nestedMessage = typeof nestedRecord.message === 'string' ? nestedRecord.message : null;
      if (nestedMessage) {
        return truncateSafe(nestedMessage);
      }
    }
  }

  if (typeof responseText === 'string' && responseText.trim()) {
    return truncateSafe(responseText);
  }

  return undefined;
};

const extractProviderCode = (responseJson?: unknown) => {
  if (!responseJson || typeof responseJson !== 'object') {
    return undefined;
  }

  const record = responseJson as Record<string, unknown>;
  if (typeof record.code === 'string') {
    return truncateSafe(record.code);
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === 'object') {
    const nestedRecord = nestedError as Record<string, unknown>;
    if (typeof nestedRecord.code === 'string') {
      return truncateSafe(nestedRecord.code);
    }
    if (typeof nestedRecord.status === 'string') {
      return truncateSafe(nestedRecord.status);
    }
  }

  return undefined;
};

const parseRetryAfterSec = (headers?: Headers) => {
  const value = headers?.get('retry-after');
  if (!value) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
  return diffSec > 0 ? diffSec : undefined;
};

export const normalizeProviderHttpError = ({
  providerName,
  status,
  responseText,
  responseJson,
  headers,
}: {
  providerName: LLMProviderName;
  status: number;
  responseText?: string;
  responseJson?: unknown;
  headers?: Headers;
}) => {
  const providerMessage = extractProviderMessage(responseJson, responseText);
  const providerCode = extractProviderCode(responseJson);

  const details: ProviderErrorDetails = {
    providerStatus: status,
    ...(providerCode ? { providerCode } : {}),
    ...(providerMessage ? { providerMessage } : {}),
  };

  if (status === 401) {
    return new ProviderError({
      code: 'unauthorized',
      status: 401,
      provider: providerName,
      message: 'Provider unauthorized.',
      details,
    });
  }

  if (status === 403) {
    return new ProviderError({
      code: 'forbidden',
      status: 403,
      provider: providerName,
      message: 'Provider forbidden request.',
      details,
    });
  }

  if (status === 429) {
    return new ProviderError({
      code: 'rate_limited',
      status: 429,
      provider: providerName,
      message: 'Provider rate limited the request.',
      retryAfterSec: parseRetryAfterSec(headers),
      details,
    });
  }

  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return new ProviderError({
      code: 'invalid_request',
      status: 400,
      provider: providerName,
      message: 'Provider rejected request.',
      details,
    });
  }

  return new ProviderError({
    code: 'upstream_error',
    status: 502,
    provider: providerName,
    message: 'Provider upstream error.',
    details,
  });
};

export const isProviderError = (error: unknown): error is ProviderError => error instanceof ProviderError;
