import { z } from 'zod';

import { createDriveClient } from './googleDrive';

export const DOC_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
];

export const MIME_GROUP_SCHEMA = z.enum(['docs', 'pdf', 'all']);
export type MimeGroup = z.infer<typeof MIME_GROUP_SCHEMA>;

export const SCOPE_SCHEMA = z.enum(['app', 'root']);
export type BrowseScope = z.infer<typeof SCOPE_SCHEMA>;

export const buildMimeFilter = (mimeGroup: MimeGroup) => {
  if (mimeGroup === 'all') {
    return '';
  }

  if (mimeGroup === 'pdf') {
    return " and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/pdf')";
  }

  const docsQuery = DOC_MIME_TYPES.map((mime) => `mimeType = '${mime}'`).join(' or ');
  return ` and (mimeType = 'application/vnd.google-apps.folder' or ${docsQuery})`;
};

export const escapeDriveQueryValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const isFolderMimeType = (mimeType?: string | null) => mimeType === 'application/vnd.google-apps.folder';

const fileMatchesMimeGroup = (mimeType: string | null | undefined, mimeGroup: MimeGroup) => {
  const safeMimeType = mimeType ?? '';
  if (mimeGroup === 'all') {
    return !isFolderMimeType(safeMimeType);
  }

  if (mimeGroup === 'pdf') {
    return safeMimeType === 'application/pdf';
  }

  return DOC_MIME_TYPES.includes(safeMimeType);
};

export type ResolveInput = {
  accessToken: string;
  driveFolderId: string;
  scope: BrowseScope;
  picked: Array<{ id: string; isFolder: boolean }>;
  mimeGroup: MimeGroup;
  limit: number;
  dryRun: boolean;
};

export type ResolvedDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
};

export type ResolveResult = {
  dryRun: boolean;
  limit: number;
  foundFiles: number;
  truncated: boolean;
  files: ResolvedDriveFile[];
};

const getFileMetadata = async (accessToken: string, fileId: string) => {
  const drive = createDriveClient(accessToken);
  return drive.files.get({ fileId, fields: 'id, name, mimeType, modifiedTime, webViewLink, parents' });
};

const assertItemWithinAppScope = async (accessToken: string, driveFolderId: string, itemId: string) => {
  if (itemId === driveFolderId) {
    return true;
  }

  const metadata = await getFileMetadata(accessToken, itemId);
  const parents = metadata.data.parents ?? [];
  return parents.includes(driveFolderId);
};

export const resolveDriveSelection = async (input: ResolveInput): Promise<ResolveResult> => {
  const drive = createDriveClient(input.accessToken);
  const seenFiles = new Set<string>();
  const seenFolders = new Set<string>();
  const queue: string[] = [];

  const orderedFiles: ResolvedDriveFile[] = [];

  for (const item of input.picked) {
    if (input.scope === 'app') {
      const allowed = await assertItemWithinAppScope(input.accessToken, input.driveFolderId, item.id);
      if (!allowed) {
        throw new Error('ITEM_OUTSIDE_APP_SCOPE');
      }
    }

    if (item.isFolder) {
      if (!seenFolders.has(item.id)) {
        seenFolders.add(item.id);
        queue.push(item.id);
      }
      continue;
    }

    const metadata = await getFileMetadata(input.accessToken, item.id);
    const id = metadata.data.id;
    if (!id || seenFiles.has(id)) {
      continue;
    }

    if (!fileMatchesMimeGroup(metadata.data.mimeType, input.mimeGroup)) {
      continue;
    }

    seenFiles.add(id);
    orderedFiles.push({
      id,
      name: metadata.data.name ?? 'Untitled',
      mimeType: metadata.data.mimeType ?? 'application/octet-stream',
      modifiedTime: metadata.data.modifiedTime ?? null,
      webViewLink: metadata.data.webViewLink ?? null,
    });
  }

  while (queue.length > 0 && orderedFiles.length < input.limit) {
    const folderId = queue.shift();
    if (!folderId) {
      continue;
    }

    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
        orderBy: 'folder,name_natural',
        pageSize: 200,
        pageToken,
        spaces: 'drive',
      });

      for (const file of response.data.files ?? []) {
        const id = file.id;
        if (!id) {
          continue;
        }

        if (isFolderMimeType(file.mimeType)) {
          if (!seenFolders.has(id)) {
            seenFolders.add(id);
            queue.push(id);
          }
          continue;
        }

        if (seenFiles.has(id) || !fileMatchesMimeGroup(file.mimeType, input.mimeGroup)) {
          continue;
        }

        seenFiles.add(id);
        orderedFiles.push({
          id,
          name: file.name ?? 'Untitled',
          mimeType: file.mimeType ?? 'application/octet-stream',
          modifiedTime: file.modifiedTime ?? null,
          webViewLink: file.webViewLink ?? null,
        });

        if (orderedFiles.length >= input.limit) {
          break;
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken && orderedFiles.length < input.limit);
  }

  const sampleSize = input.dryRun ? 50 : input.limit;

  return {
    dryRun: input.dryRun,
    limit: input.limit,
    foundFiles: orderedFiles.length,
    truncated: orderedFiles.length >= input.limit,
    files: orderedFiles.slice(0, sampleSize),
  };
};
