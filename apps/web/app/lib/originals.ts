import type { drive_v3, gmail_v1 } from 'googleapis';

import { normalizeWhitespace, stripHtml, trimQuotedReplies } from './gmailText';

export type OriginalArtifactSummary = {
  artifactId: string;
  title: string;
  source: 'gmail' | 'drive';
  sourceId: string;
};

export type OpenedOriginal = {
  artifactId: string;
  title: string;
  source: 'gmail' | 'drive';
  sourceId: string;
  text: string;
  truncated: boolean;
  note?: string;
};

export const MAX_ORIGINAL_CHARS_PER_ITEM = 150_000;
export const MAX_ORIGINAL_CHARS_TOTAL = 300_000;

const asUtf8 = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const walkPartsForMime = (
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): string | null => {
  if (!payload) {
    return null;
  }

  if (payload.mimeType?.toLowerCase() === mimeType && payload.body?.data) {
    return payload.body.data;
  }

  for (const part of payload.parts ?? []) {
    const found = walkPartsForMime(part, mimeType);
    if (found) {
      return found;
    }
  }

  return null;
};

const parseGmailText = (payload: gmail_v1.Schema$MessagePart | undefined) => {
  const plainData = walkPartsForMime(payload, 'text/plain');
  if (plainData) {
    return trimQuotedReplies(normalizeWhitespace(asUtf8(plainData)));
  }

  const htmlData = walkPartsForMime(payload, 'text/html');
  if (htmlData) {
    const stripped = stripHtml(asUtf8(htmlData));
    return trimQuotedReplies(normalizeWhitespace(stripped));
  }

  if (payload?.body?.data) {
    return trimQuotedReplies(normalizeWhitespace(stripHtml(asUtf8(payload.body.data))));
  }

  return '';
};

export const truncateOriginalText = (
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } => {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  const clipped = value.slice(0, Math.max(0, maxChars - 15)).trimEnd();
  return { text: `${clipped}...[truncated]`, truncated: true };
};

export const fetchOriginalTextForArtifact = async (
  drive: drive_v3.Drive,
  gmail: gmail_v1.Gmail,
  artifactSummary: OriginalArtifactSummary,
): Promise<OpenedOriginal> => {
  if (artifactSummary.source === 'gmail') {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: artifactSummary.sourceId,
      format: 'full',
    });

    const extracted = parseGmailText(response.data.payload);
    const normalized = normalizeWhitespace(extracted);
    const { text, truncated } = truncateOriginalText(normalized, MAX_ORIGINAL_CHARS_PER_ITEM);

    return {
      artifactId: artifactSummary.artifactId,
      title: artifactSummary.title,
      source: artifactSummary.source,
      sourceId: artifactSummary.sourceId,
      text: text || '[Original email had no extractable text content.]',
      truncated,
    };
  }

  const metadata = await drive.files.get({
    fileId: artifactSummary.sourceId,
    fields: 'mimeType,name',
  });
  const mimeType = metadata.data.mimeType ?? '';

  if (mimeType === 'application/vnd.google-apps.document') {
    const exported = await drive.files.export(
      { fileId: artifactSummary.sourceId, mimeType: 'text/plain' },
      { responseType: 'arraybuffer' },
    );
    const content = Buffer.from(exported.data as ArrayBuffer).toString('utf8');
    const normalized = normalizeWhitespace(content);
    const { text, truncated } = truncateOriginalText(normalized, MAX_ORIGINAL_CHARS_PER_ITEM);
    return {
      artifactId: artifactSummary.artifactId,
      title: artifactSummary.title,
      source: artifactSummary.source,
      sourceId: artifactSummary.sourceId,
      text: text || '[Google Doc export returned no text.]',
      truncated,
    };
  }

  if (mimeType === 'application/pdf') {
    return {
      artifactId: artifactSummary.artifactId,
      title: artifactSummary.title,
      source: artifactSummary.source,
      sourceId: artifactSummary.sourceId,
      text: 'PDF original is not extractable here; open in Drive.',
      truncated: false,
      note: 'not_extractable',
    };
  }

  if (mimeType.startsWith('text/')) {
    const exported = await drive.files.get(
      { fileId: artifactSummary.sourceId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    const content = Buffer.from(exported.data as ArrayBuffer).toString('utf8');
    const normalized = normalizeWhitespace(content);
    const { text, truncated } = truncateOriginalText(normalized, MAX_ORIGINAL_CHARS_PER_ITEM);
    return {
      artifactId: artifactSummary.artifactId,
      title: artifactSummary.title,
      source: artifactSummary.source,
      sourceId: artifactSummary.sourceId,
      text: text || '[Text file returned no content.]',
      truncated,
    };
  }

  return {
    artifactId: artifactSummary.artifactId,
    title: artifactSummary.title,
    source: artifactSummary.source,
    sourceId: artifactSummary.sourceId,
    text: `Drive original type (${mimeType || 'unknown'}) is not supported for extraction.`,
    truncated: false,
    note: 'unsupported_type',
  };
};
