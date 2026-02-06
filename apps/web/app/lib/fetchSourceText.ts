import type { drive_v3, gmail_v1 } from 'googleapis';

type SourceText = {
  title: string;
  text: string;
  dateISO?: string;
};

const decodeBase64 = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
};

const stripHtml = (value: string) =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

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
  const detail = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const payload = detail.data.payload;
  const headers = payload?.headers ?? [];
  const subject = headerValue(headers, 'Subject') || '(no subject)';
  const dateISO = parseDateISO(headerValue(headers, 'Date'));

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

  return {
    title: subject,
    text,
    dateISO,
  };
};

export const fetchDriveFileText = async (
  drive: drive_v3.Drive,
  fileId: string,
): Promise<SourceText> => {
  const metadata = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, modifiedTime',
  });

  const title = metadata.data.name ?? 'Untitled';
  const mimeType = metadata.data.mimeType ?? 'application/octet-stream';
  const dateISO = parseDateISO(metadata.data.modifiedTime);

  const isGoogleDoc = mimeType === 'application/vnd.google-apps.document';
  const isText = mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown';

  if (isGoogleDoc) {
    const exportResponse = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' },
    );
    const text = typeof exportResponse.data === 'string' ? exportResponse.data : '';
    return { title, text, dateISO };
  }

  if (isText) {
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    const text = typeof response.data === 'string' ? response.data : '';
    return { title, text, dateISO };
  }

  return {
    title,
    text: `Unsupported in Phase 2A. This file type ("${mimeType}") is not yet summarized.`,
    dateISO,
  };
};
