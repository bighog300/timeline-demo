import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from './googleRequest';
import type { LogContext } from './logger';
import { time } from './logger';
import type { SummaryArtifact } from './types';
import { assertPayloadWithinLimit, sanitizeDriveFileName } from './driveSafety';

type DriveWriteResult = {
  markdownFileId: string;
  markdownWebViewLink?: string;
  jsonFileId: string;
  jsonWebViewLink?: string;
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
  ctx?: LogContext,
): Promise<DriveWriteResult> => {
  const baseName = sanitizeDriveFileName(artifact.title, 'Timeline Item');
  const markdownName = `${baseName} - Summary.md`;
  const jsonName = `${baseName} - Summary.json`;
  const markdownPayload = buildMarkdown(artifact);
  const jsonPayload = JSON.stringify(artifact, null, 2);

  assertPayloadWithinLimit(markdownPayload, 'Summary markdown payload');
  assertPayloadWithinLimit(jsonPayload, 'Summary JSON payload');

  const markdownOperation = () =>
    withRetry(
      (signal) =>
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
                  body: markdownPayload,
                },
                fields: 'id, webViewLink, name',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const markdownResponse = ctx
    ? await time(ctx, 'drive.files.create.summary_markdown', markdownOperation)
    : await markdownOperation();

  const jsonOperation = () =>
    withRetry(
      (signal) =>
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
                  body: jsonPayload,
                },
                fields: 'id, webViewLink, name',
              },
              { signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      { ctx },
    );
  const jsonResponse = ctx
    ? await time(ctx, 'drive.files.create.summary_json', jsonOperation)
    : await jsonOperation();

  return {
    markdownFileId: markdownResponse.data.id ?? '',
    markdownWebViewLink: markdownResponse.data.webViewLink ?? undefined,
    jsonFileId: jsonResponse.data.id ?? '',
    jsonWebViewLink: jsonResponse.data.webViewLink ?? undefined,
  };
};
