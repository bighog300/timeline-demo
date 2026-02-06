import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { SummaryArtifact } from './types';

type DriveWriteResult = {
  markdownFileId: string;
  markdownWebViewLink?: string;
  jsonFileId: string;
  jsonWebViewLink?: string;
};

const safeFileName = (value: string) => {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, '').trim();
  return sanitized || 'Timeline Item';
};

const buildMetadataLines = (artifact: SummaryArtifact) => {
  const metadata = artifact.sourceMetadata;
  if (!metadata) {
    return [];
  }

  const lines: string[] = [];
  const pushLine = (label: string, value?: string | string[]) => {
    if (!value || lines.length >= 6) {
      return;
    }
    const formatted = Array.isArray(value) ? value.join(', ') : value;
    if (formatted) {
      lines.push(`- ${label}: ${formatted}`);
    }
  };

  if (artifact.source === 'gmail') {
    pushLine('From', metadata.from);
    pushLine('To', metadata.to);
    pushLine('Subject', metadata.subject);
    pushLine('Date', metadata.dateISO);
    pushLine('Thread', metadata.threadId);
    pushLine('Labels', metadata.labels);
  } else {
    pushLine('File', metadata.driveName);
    pushLine('MIME type', metadata.mimeType);
    pushLine('Modified', metadata.driveModifiedTime);
    pushLine('Drive link', metadata.driveWebViewLink);
  }

  return lines;
};

const buildMarkdown = (artifact: SummaryArtifact) => {
  const highlights = artifact.highlights.map((item) => `- ${item}`).join('\n');
  const metadataLines = buildMetadataLines(artifact);
  const metadataSection = metadataLines.length
    ? `\n\n## Source metadata\n${metadataLines.join('\n')}`
    : '';
  return `# ${artifact.title}\n\n${artifact.summary}\n\n## Highlights\n${highlights || '- (none)'}${metadataSection}\n`;
};

export const writeArtifactToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  artifact: SummaryArtifact,
): Promise<DriveWriteResult> => {
  const baseName = safeFileName(artifact.title);
  const markdownName = `${baseName} - Summary.md`;
  const jsonName = `${baseName} - Summary.json`;

  const markdownResponse = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: {
              name: markdownName,
              parents: [folderId],
              mimeType: 'text/markdown',
            },
            media: {
              mimeType: 'text/markdown',
              body: buildMarkdown(artifact),
            },
            fields: 'id, webViewLink, name',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  const jsonResponse = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: {
              name: jsonName,
              parents: [folderId],
              mimeType: 'application/json',
            },
            media: {
              mimeType: 'application/json',
              body: JSON.stringify(artifact, null, 2),
            },
            fields: 'id, webViewLink, name',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return {
    markdownFileId: markdownResponse.data.id ?? '',
    markdownWebViewLink: markdownResponse.data.webViewLink ?? undefined,
    jsonFileId: jsonResponse.data.id ?? '',
    jsonWebViewLink: jsonResponse.data.webViewLink ?? undefined,
  };
};
