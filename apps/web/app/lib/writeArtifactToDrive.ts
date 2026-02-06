import type { drive_v3 } from 'googleapis';

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

const buildMarkdown = (artifact: SummaryArtifact) => {
  const highlights = artifact.highlights.map((item) => `- ${item}`).join('\n');
  return `# ${artifact.title}\n\n${artifact.summary}\n\n## Highlights\n${highlights || '- (none)'}\n`;
};

export const writeArtifactToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  artifact: SummaryArtifact,
): Promise<DriveWriteResult> => {
  const baseName = safeFileName(artifact.title);
  const markdownName = `${baseName} - Summary.md`;
  const jsonName = `${baseName} - Summary.json`;

  const markdownResponse = await drive.files.create({
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
  });

  const jsonResponse = await drive.files.create({
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
  });

  return {
    markdownFileId: markdownResponse.data.id ?? '',
    markdownWebViewLink: markdownResponse.data.webViewLink ?? undefined,
    jsonFileId: jsonResponse.data.id ?? '',
    jsonWebViewLink: jsonResponse.data.webViewLink ?? undefined,
  };
};
