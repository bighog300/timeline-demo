import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'reconnect_required'
  | 'drive_not_provisioned'
  | 'forbidden_outside_folder'
  | 'query_too_short'
  | 'rate_limited'
  | 'upstream_timeout'
  | 'upstream_error'
  | 'invalid_request'
  | 'too_many_items'
  | 'provider_not_configured'
  | 'provider_bad_output'
  | 'forbidden'
  | 'bad_request'
  | 'internal_error';

export type ApiErrorPayload = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
  error_code: ApiErrorCode;
};

export const jsonError = (
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) => {
  const payload: ApiErrorPayload = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    error_code: code,
  };

  return NextResponse.json(payload, { status });
};

export const parseApiError = async (response: Response) => {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  try {
    const payload = (await response.clone().json()) as unknown;

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const errorField = record.error;

      if (errorField && typeof errorField === 'object') {
        const errorRecord = errorField as Record<string, unknown>;
        const code = errorRecord.code;
        const message = errorRecord.message;
        if (typeof code === 'string' && typeof message === 'string') {
          return { code, message, details: errorRecord.details, requestId };
        }
      }

      if (typeof errorField === 'string') {
        const message =
          typeof record.message === 'string' ? record.message : errorField.replace(/_/g, ' ');
        return {
          code: errorField,
          message,
          details: record.details,
          requestId,
        };
      }

      if (typeof record.error_code === 'string') {
        const message =
          typeof record.message === 'string'
            ? record.message
            : record.error_code.replace(/_/g, ' ');
        return {
          code: record.error_code,
          message,
          details: record.details,
          requestId,
        };
      }
    }
  } catch {
    return null;
  }

  if (requestId) {
    return { code: 'unknown_error', message: 'unknown_error', details: undefined, requestId };
  }

  return null;
};
