import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
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

type GmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

const headerValue = (headers: { name?: string | null; value?: string | null }[], key: string) => {
  const header = headers.find((item) => item.name?.toLowerCase() === key.toLowerCase());
  return header?.value ?? '';
};

export const GET = async (request: NextRequest) => {
  const ctx = createCtx(request, '/api/google/gmail/list');
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
    return respond(jsonError(401, 'reconnect_required', 'Reconnect required.'));
  }

  ctx.userHint = session.user?.email ? hashUserHint(session.user.email) : 'anon';

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
                  maxResults: 20,
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
    const mapped = mapGoogleError(error, 'gmail.users.messages.list');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  const messageRefs = listResponse.data.messages ?? [];

  let messageDetails: GmailMessage[];
  try {
    messageDetails = await Promise.all(
      messageRefs.map(async (message) => {
        const detail = await time(ctx, 'gmail.users.messages.get', () =>
          withRetry(
            (signal) =>
              withTimeout(
                (timeoutSignal) =>
                  gmail.users.messages.get(
                    {
                      userId: 'me',
                      id: message.id ?? '',
                      format: 'metadata',
                      metadataHeaders: ['Subject', 'From', 'Date'],
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

        return {
          id: detail.data.id ?? '',
          threadId: detail.data.threadId ?? '',
          subject: headerValue(headers, 'Subject') || '(no subject)',
          from: headerValue(headers, 'From') || 'Unknown sender',
          date: headerValue(headers, 'Date') || '',
          snippet: detail.data.snippet ?? '',
        } as GmailMessage;
      }),
    );
  } catch (error) {
    logGoogleError(error, 'gmail.users.messages.get', ctx);
    const mapped = mapGoogleError(error, 'gmail.users.messages.get');
    logError(ctx, 'request_error', {
      status: mapped.status,
      code: mapped.code,
      error: safeError(error),
    });
    return respond(jsonError(mapped.status, mapped.code, mapped.message, mapped.details));
  }

  return respond(NextResponse.json({ messages: messageDetails }));
};
