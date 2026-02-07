import type { drive_v3, gmail_v1 } from 'googleapis';

import { buildUnsupportedPlaceholder, normalizeJsonText, truncateText } from './driveText';
import { normalizeWhitespace, stripHtml, trimQuotedReplies } from './gmailText';
import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { time } from './logger';
import { ocrPdfToText } from './googleDrive';
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

const DEFAULT_PDF_OCR_MAX_BYTES = 10 * 1024 * 1024;

const parseEnvBoolean = (value?: string) => {
  if (!value) {
    return false;
  }
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const getPdfOcrMaxBytes = () => {
  const raw = process.env.PDF_OCR_MAX_BYTES;
  if (!raw) {
    return DEFAULT_PDF_OCR_MAX_BYTES;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PDF_OCR_MAX_BYTES;
};

const buildPdfPlaceholder = ({
  name,
  webViewLink,
  note,
}: {
  name: string;
  webViewLink?: string;
  note: string;
}) => {
  const base = buildUnsupportedPlaceholder({
    name,
    mimeType: 'application/pdf',
    webViewLink,
  });
  return `${base}\n${note}`;
};

export const fetchGmailMessageText = async (
  gmail: gmail_v1.Gmail,
  messageId: string,
  ctx?: LogContext,
): Promise<SourceText> => {
  const operation = () =>
    withRetry(
      (signal) =>
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
      { ctx },
    );

  const detail = ctx ? await time(ctx, 'gmail.users.messages.get', operation) : await operation();

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
  folderId: string,
  ctx?: LogContext,
): Promise<SourceText> => {
  const metadataOperation = () =>
    withRetry(
      (signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.get(
              {
                fileId,
                fields: 'id, name, mimeType, modifiedTime, webViewLink, size',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const metadata = ctx
    ? await time(ctx, 'drive.files.get.metadata', metadataOperation)
    : await metadataOperation();

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
  const isPdf = mimeType === 'application/pdf';

  if (isGoogleDoc) {
    const exportOperation = () =>
      withRetry(
        (signal) =>
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
        { ctx },
      );
    const exportResponse = ctx
      ? await time(ctx, 'drive.files.export', exportOperation)
      : await exportOperation();
    const text = typeof exportResponse.data === 'string' ? exportResponse.data : '';
    return { title, text: truncateText(text), dateISO, metadata: sourceMetadata };
  }

  if (isText || isJson || isCsv) {
    const textOperation = () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'text', signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      );
    const response = ctx
      ? await time(ctx, 'drive.files.get.media', textOperation)
      : await textOperation();
    const rawText = typeof response.data === 'string' ? response.data : '';
    const text = isJson ? normalizeJsonText(rawText) : rawText;
    return { title, text: truncateText(text), dateISO, metadata: sourceMetadata };
  }

  if (isPdf) {
    const sizeBytes = metadata.data.size ? Number(metadata.data.size) : undefined;
    const maxBytes = getPdfOcrMaxBytes();
    if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > maxBytes) {
      return {
        title,
        text: buildPdfPlaceholder({
          name: title,
          webViewLink: metadata.data.webViewLink ?? undefined,
          note: 'PDF is too large for OCR in this flow (too_large). Please choose a smaller PDF.',
        }),
        dateISO,
        metadata: sourceMetadata,
      };
    }

    try {
      const ocrLanguage = process.env.DRIVE_OCR_LANGUAGE?.trim() || 'en';
      const keepOcrDoc = parseEnvBoolean(process.env.DRIVE_KEEP_OCR_DOC);
      const { text } = await ocrPdfToText({
        drive,
        fileId,
        folderId,
        filename: title,
        ocrLanguage,
        keepOcrDoc,
        ctx,
      });
      return { title, text: truncateText(text), dateISO, metadata: sourceMetadata };
    } catch {
      return {
        title,
        text: buildPdfPlaceholder({
          name: title,
          webViewLink: metadata.data.webViewLink ?? undefined,
          note: 'Could not extract text via OCR. Open the PDF in Drive and export it to Google Docs.',
        }),
        dateISO,
        metadata: sourceMetadata,
      };
    }
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
