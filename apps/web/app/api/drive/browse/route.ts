import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';

const QuerySchema = z.object({
  folderId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  pageToken: z.string().trim().min(1).optional(),
  mimeGroup: z.enum(['docs', 'pdf', 'all']).optional(),
});

const escapeDriveQueryValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const DOC_MIME_TYPES = [
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

const buildMimeFilter = (mimeGroup: 'docs' | 'pdf' | 'all') => {
  if (mimeGroup === 'all') {
    return '';
  }

  if (mimeGroup === 'pdf') {
    return " and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/pdf')";
  }

  const docsQuery = DOC_MIME_TYPES.map((mime) => `mimeType = '${mime}'`).join(' or ');
  return ` and (mimeType = 'application/vnd.google-apps.folder' or ${docsQuery})`;
};

const listDirectChildFolderIds = async (driveFolderId: string, accessToken: string) => {
  const drive = createDriveClient(accessToken);
  const response = await drive.files.list({
    q: `'${escapeDriveQueryValue(driveFolderId)}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id)',
    pageSize: 200,
    spaces: 'drive',
  });

  const childIds = new Set<string>();
  for (const file of response.data.files ?? []) {
    if (file.id) {
      childIds.add(file.id);
    }
  }

  return childIds;
};

export const GET = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const url = request.nextUrl ?? new URL(request.url);

  const parsedQuery = QuerySchema.safeParse({
    folderId: url.searchParams.get('folderId') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    pageToken: url.searchParams.get('pageToken') ?? undefined,
    mimeGroup: url.searchParams.get('mimeGroup') ?? undefined,
  });

  if (!parsedQuery.success) {
    return jsonError(400, 'bad_request', 'Invalid query parameters.', parsedQuery.error.flatten());
  }

  const folderId = parsedQuery.data.folderId ?? session.driveFolderId;
  const mimeGroup = parsedQuery.data.mimeGroup ?? 'all';

  try {
    if (folderId !== session.driveFolderId) {
      const childFolderIds = await listDirectChildFolderIds(session.driveFolderId, accessToken);
      if (!childFolderIds.has(folderId)) {
        return jsonError(403, 'forbidden', 'Folder is outside the app Drive scope.');
      }
    }

    const drive = createDriveClient(accessToken);
    const qParts = [`'${escapeDriveQueryValue(folderId)}' in parents`, 'trashed = false'];

    if (parsedQuery.data.q) {
      qParts.push(`name contains '${escapeDriveQueryValue(parsedQuery.data.q)}'`);
    }

    const query = qParts.join(' and ') + buildMimeFilter(mimeGroup);
    const response = await drive.files.list({
      q: query,
      pageSize: 50,
      pageToken: parsedQuery.data.pageToken,
      orderBy: 'folder,name_natural',
      spaces: 'drive',
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
    });

    const items = (response.data.files ?? [])
      .filter((file) => file.id)
      .map((file) => ({
        id: file.id ?? '',
        name: file.name ?? 'Untitled',
        mimeType: file.mimeType ?? 'application/octet-stream',
        modifiedTime: file.modifiedTime ?? null,
        webViewLink: file.webViewLink ?? null,
        isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      }));

    return NextResponse.json({
      folderId,
      items,
      nextPageToken: response.data.nextPageToken ?? null,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
