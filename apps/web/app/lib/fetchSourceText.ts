import type { drive_v3, gmail_v1 } from 'googleapis';

import { buildUnsupportedPlaceholder, normalizeJsonText, truncateText } from './driveText';
import { normalizeWhitespace, stripHtml, trimQuotedReplies } from './gmailText';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { SourceMetadata } from './types';

type SourceText = {
  title: string;
  text: string;
  dateISO?: string;
  metadata?: SourceMetadata;
};

const decodeBase64 = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
};

const findPart = (
  parts: gmail_v1.Schema$MessagePart[] | undefined,
  mimeType: string,
): gmail_v1.Schema$MessagePart | undefined => {
  if (!parts) {
    return undefined;
  }

  for (const part of parts) {
    if (part.mimeType === mimeType) {
      return part;
    }

    const nested = findPart(part.parts ?? [], mimeType);
    if (nested) {
      return nested;
    }
  }

  return undefined;
};

const headerValue = (headers: { name?: string | null; value?: string | null }[], key: string) => {
  const header = headers.find((item) => item.name?.toLowerCase() === key.toLowerCase());
  return header?.value ?? '';
};

const parseDateISO = (value?: string | null) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

export const fetchGmailMessageText = async (
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<SourceText> => {
  const detail = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        gmail.users.messages.get(
          {
            userId: 'me',
            id: messageId,
            format: 'full',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const payload = detail.data.payload;
  const headers = payload?.headers ?? [];
  const subject = headerValue(headers, 'Subject') || '(no subject)';
  const dateISO = parseDateISO(headerValue(headers, 'Date'));
  const from = headerValue(headers, 'From');
  const to = headerValue(headers, 'To');

  const plainPart = findPart(payload?.parts ?? [], 'text/plain') ?? payload;
  const htmlPart = findPart(payload?.parts ?? [], 'text/html');

  let text = '';

  if (plainPart?.body?.data) {
    text = decodeBase64(plainPart.body.data);
  } else if (htmlPart?.body?.data) {
    text = stripHtml(decodeBase64(htmlPart.body.data));
  } else if (payload?.body?.data) {
    text = decodeBase64(payload.body.data);
  } else {
    text = detail.data.snippet ?? '';
  }

  const cleaned = normalizeWhitespace(trimQuotedReplies(text));

  return {
    title: subject,
    text: cleaned,
    dateISO,
    metadata: {
      from: from || undefined,
      to: to || undefined,
      subject: subject || undefined,
      dateISO,
      threadId: detail.data.threadId ?? undefined,
      labels: detail.data.labelIds ?? undefined,
    },
  };
};

export const fetchDriveFileText = async (
  drive: drive_v3.Drive,
  fileId: string,
): Promise<SourceText> => {
  const metadata = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get(
          {
            fileId,
            fields: 'id, name, mimeType, modifiedTime, webViewLink',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const title = metadata.data.name ?? 'Untitled';
  const mimeType = metadata.data.mimeType ?? 'application/octet-stream';
  const dateISO = parseDateISO(metadata.data.modifiedTime);
  const sourceMetadata: SourceMetadata = {
    mimeType,
    driveName: title,
    driveModifiedTime: metadata.data.modifiedTime ?? undefined,
    driveWebViewLink: metadata.data.webViewLink ?? undefined,
  };

  const isGoogleDoc = mimeType === 'application/vnd.google-apps.document';
  const isText =
    mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown';
  const isJson = mimeType === 'application/json';
  const isCsv = mimeType === 'text/csv';

  if (isGoogleDoc) {
    const exportResponse = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.export(
            { fileId, mimeType: 'text/plain' },
            { responseType: 'text', signal: timeoutSignal },
          ),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
    const text = typeof exportResponse.data === 'string' ? exportResponse.data : '';
    return { title, text: truncateText(text), dateISO, metadata: sourceMetadata };
  }

  if (isText || isJson || isCsv) {
    const response = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.get({ fileId, alt: 'media' }, { responseType: 'text', signal: timeoutSignal }),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
    const rawText = typeof response.data === 'string' ? response.data : '';
    const text = isJson ? normalizeJsonText(rawText) : rawText;
    return { title, text: truncateText(text), dateISO, metadata: sourceMetadata };
  }

  return {
    title,
    text: buildUnsupportedPlaceholder({
      name: title,
      mimeType,
      webViewLink: metadata.data.webViewLink ?? undefined,
    }),
    dateISO,
    metadata: sourceMetadata,
  };
};
