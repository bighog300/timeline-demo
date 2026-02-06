import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createGmailClient } from '../../../../lib/googleGmail';

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
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  const gmail = createGmailClient(accessToken);
  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 20,
  });

  const messageRefs = listResponse.data.messages ?? [];

  const messageDetails = await Promise.all(
    messageRefs.map(async (message) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: message.id ?? '',
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

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

  return NextResponse.json({ messages: messageDetails });
};
