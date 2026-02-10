import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createGmailClient } from '../../../../lib/googleGmail';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../../lib/googleRequest';
import { hashUserHint, logError, logInfo, safeError, time } from '../../../../lib/logger';
import { createCtx, withRequestId } from '../../../../lib/requestContext';

type SearchBody = {
  q?: string;
  maxResults?: number;
  pageToken?: string | null;
};

type GmailSearchMessage = {
  id: string;
  threadId: string;
  internalDate: number;
  snippet: string;
  from: {
    name: string;
    email: string;
  };
  subject: string;
  date: string;
};

const MAX_QUERY_LENGTH = 2000;
const DEFAULT_MAX_RESULTS = 50;
const HARD_MAX_RESULTS = 100;
const METADATA_CONCURRENCY = 5;

const getHeaderValue = (headers: { name?: string | null; value?: string | null }[], key: string) => {
  const header = headers.find((item) => item.name?.toLowerCase() === key.toLowerCase());
  return header?.value?.trim() ?? '';
};

const parseFromHeader = (fromHeader: string) => {
  const value = fromHeader.trim();
  if (!value) {
    return { name: '', email: '' };
  }

  const bracketMatch = value.match(/^(.*)<([^>]+)>$/);
  if (bracketMatch) {
    return {
      name: bracketMatch[1].trim().replace(/^"|"$/g, '') || bracketMatch[2].trim().toLowerCase(),
      email: bracketMatch[2].trim().toLowerCase(),
    };
  }

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) {
    return { name: value, email: '' };
  }

  const email = emailMatch[0].toLowerCase();
  const name = value.replace(emailMatch[0], '').replace(/[<>"()]/g, '').trim();
  return { name: name || email, email };
};

const createErrorResponse = (
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) =>
  NextResponse.json(
    {
      ok: false,
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
    { status },
  );

const mapAuthError = (error: unknown, requestName: string) => {
  const status =
    typeof error === 'object' && error && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;

  if (status === 401) {
    return {
      status: 401,
      code: 'reconnect_required',
      message: 'Reconnect Google',
      details: { request: requestName, status },
    };
  }

  return mapGoogleError(error, requestName);
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let index = 0;

  const worker = async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await task(items[currentIndex]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
};

export const POST = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/google/gmail/search');
  const startedAt = Date.now();
  const respond = (response: NextResponse) => {
    withRequestId(response, ctx.requestId);
    logInfo(ctx, 'request_end', { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  };

  logInfo(ctx, 'request_start', { method: request.method });

  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return respond(createErrorResponse(401, 'reconnect_required', 'Reconnect Google', ctx.requestId));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return respond(createErrorResponse(400, 'invalid_request', 'Invalid request body', ctx.requestId));
  }

  const q = typeof body.q === 'string' ? body.q.trim() : '';
  if (!q || q.length > MAX_QUERY_LENGTH) {
    return respond(
      createErrorResponse(
        400,
        'invalid_request',
        `Query is required and must be <= ${MAX_QUERY_LENGTH} characters`,
        ctx.requestId,
      ),
    );
  }

  const parsedMaxResults =
    typeof body.maxResults === 'number' && Number.isFinite(body.maxResults)
      ? Math.floor(body.maxResults)
      : DEFAULT_MAX_RESULTS;

  if (parsedMaxResults < 1 || parsedMaxResults > HARD_MAX_RESULTS) {
    return respond(
      createErrorResponse(
        400,
        'invalid_request',
        `maxResults must be between 1 and ${HARD_MAX_RESULTS}`,
        ctx.requestId,
      ),
    );
  }

  const pageToken = typeof body.pageToken === 'string' && body.pageToken.trim() ? body.pageToken.trim() : undefined;

  const gmail = createGmailClient(accessToken);

  let listResponse;
  try {
    listResponse = await time(ctx, 'gmail.users.messages.list', () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              gmail.users.messages.list(
                {
                  userId: 'me',
                  q,
                  maxResults: parsedMaxResults,
                  pageToken,
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      ),
    );
  } catch (error) {
    logGoogleError(error, 'gmail.users.messages.list', ctx);
    const mapped = mapAuthError(error, 'gmail.users.messages.list');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(createErrorResponse(mapped.status, mapped.code, mapped.message, ctx.requestId, mapped.details));
  }

  const messageRefs = listResponse.data.messages ?? [];

  let messages: GmailSearchMessage[] = [];
  try {
    messages = await runWithConcurrency(messageRefs, METADATA_CONCURRENCY, async (messageRef) => {
      const messageId = messageRef.id ?? '';
      const detail = await time(ctx, 'gmail.users.messages.get', () =>
        withRetry(
          (signal) =>
            withTimeout(
              (timeoutSignal) =>
                gmail.users.messages.get(
                  {
                    userId: 'me',
                    id: messageId,
                    format: 'metadata',
                    metadataHeaders: ['From', 'Subject', 'Date'],
                  },
                  { signal: timeoutSignal },
                ),
              DEFAULT_GOOGLE_TIMEOUT_MS,
              'upstream_timeout',
              signal,
            ),
          { ctx },
        ),
      );

      const headers = detail.data.payload?.headers ?? [];
      const from = parseFromHeader(getHeaderValue(headers, 'From'));

      return {
        id: detail.data.id ?? messageId,
        threadId: detail.data.threadId ?? '',
        internalDate: Number(detail.data.internalDate ?? 0),
        snippet: detail.data.snippet ?? '',
        from,
        subject: getHeaderValue(headers, 'Subject') || '(no subject)',
        date: getHeaderValue(headers, 'Date'),
      };
    });
  } catch (error) {
    logGoogleError(error, 'gmail.users.messages.get', ctx);
    const mapped = mapAuthError(error, 'gmail.users.messages.get');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(createErrorResponse(mapped.status, mapped.code, mapped.message, ctx.requestId, mapped.details));
  }

  return respond(
    NextResponse.json({
      ok: true,
      requestId: ctx.requestId,
      query: q,
      resultCount: messages.length,
      nextPageToken: listResponse.data.nextPageToken ?? null,
      messages,
    }),
  );
};
