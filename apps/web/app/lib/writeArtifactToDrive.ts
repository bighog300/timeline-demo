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

const buildJsonPayload = (
  artifact: SummaryArtifact,
  overrides: { driveFileId?: string; driveWebViewLink?: string } = {},
) => {
  const driveFileId = overrides.driveFileId ?? artifact.driveFileId;
  const driveWebViewLink = overrides.driveWebViewLink ?? artifact.driveWebViewLink;
  return {
    ...artifact,
    driveFileId,
    driveWebViewLink,
    type: 'summary',
    status: 'complete',
    id: artifact.artifactId,
    updatedAtISO: artifact.createdAtISO,
    meta: {
      mimeType: artifact.sourceMetadata?.mimeType,
      driveFileId,
      driveWebViewLink,
      driveFolderId: artifact.driveFolderId,
      source: artifact.source,
      sourceId: artifact.sourceId,
      model: artifact.model,
      version: artifact.version,
    },
  };
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
  const shouldWriteMarkdown = process.env.DRIVE_WRITE_SUMMARY_MD !== 'false';
  const markdownPayload = shouldWriteMarkdown ? buildMarkdown(artifact) : '';
  const initialJsonPayload = JSON.stringify(buildJsonPayload(artifact), null, 2);

  if (shouldWriteMarkdown) {
    assertPayloadWithinLimit(markdownPayload, 'Summary markdown payload');
  }
  assertPayloadWithinLimit(initialJsonPayload, 'Summary JSON payload');

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
                  body: initialJsonPayload,
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

  const jsonFileId = jsonResponse.data.id ?? '';
  const jsonWebViewLink = jsonResponse.data.webViewLink ?? undefined;
  const finalJsonPayload = JSON.stringify(
    buildJsonPayload(artifact, {
      driveFileId: jsonFileId,
      driveWebViewLink: jsonWebViewLink,
    }),
    null,
    2,
  );

  if (jsonFileId) {
    const updateOperation = () =>
      withRetry(
        (signal) =>
          withTimeout(
            (timeoutSignal) =>
              drive.files.update(
                {
                  fileId: jsonFileId,
                  media: {
                    mimeType: 'application/json',
                    body: finalJsonPayload,
                  },
                  fields: 'id, webViewLink',
                },
                { signal: timeoutSignal },
              ),
            DEFAULT_GOOGLE_TIMEOUT_MS,
            'upstream_timeout',
            signal,
          ),
        { ctx },
      );
    const updateResponse = ctx
      ? await time(ctx, 'drive.files.update.summary_json', updateOperation)
      : await updateOperation();
    if (updateResponse.data.webViewLink) {
      jsonResponse.data.webViewLink = updateResponse.data.webViewLink;
    }
  }

  let markdownFileId = '';
  let markdownWebViewLink: string | undefined;

  if (shouldWriteMarkdown) {
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
    markdownFileId = markdownResponse.data.id ?? '';
    markdownWebViewLink = markdownResponse.data.webViewLink ?? undefined;
  }

  return {
    markdownFileId,
    markdownWebViewLink,
    jsonFileId,
    jsonWebViewLink: jsonResponse.data.webViewLink ?? undefined,
  };
};
