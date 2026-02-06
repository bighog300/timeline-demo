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

export const GET = async (_request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  const gmail = createGmailClient(accessToken);
  let listResponse;
  try {
    listResponse = await withRetry((signal) =>
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
    );
  } catch (error) {
    logGoogleError(error, 'gmail.users.messages.list');
    const mapped = mapGoogleError(error, 'gmail.users.messages.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  const messageRefs = listResponse.data.messages ?? [];

  let messageDetails: GmailMessage[];
  try {
    messageDetails = await Promise.all(
      messageRefs.map(async (message) => {
        const detail = await withRetry((signal) =>
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
    logGoogleError(error, 'gmail.users.messages.get');
    const mapped = mapGoogleError(error, 'gmail.users.messages.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  return NextResponse.json({ messages: messageDetails });
};
