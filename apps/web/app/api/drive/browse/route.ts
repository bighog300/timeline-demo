import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { jsonError } from '../../../lib/apiErrors';
import {
  buildMimeFilter,
  escapeDriveQueryValue,
  SCOPE_SCHEMA,
} from '../../../lib/driveBrowseSelection';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../lib/googleRequest';

const QuerySchema = z.object({
  folderId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  pageToken: z.string().trim().min(1).optional(),
  mimeGroup: z.enum(['docs', 'pdf', 'all']).optional(),
  scope: SCOPE_SCHEMA.optional(),
});

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
    scope: url.searchParams.get('scope') ?? undefined,
  });

  if (!parsedQuery.success) {
    return jsonError(400, 'bad_request', 'Invalid query parameters.', parsedQuery.error.flatten());
  }

  const scope = parsedQuery.data.scope ?? 'app';
  const folderId = parsedQuery.data.folderId ?? (scope === 'root' ? 'root' : session.driveFolderId);
  const mimeGroup = parsedQuery.data.mimeGroup ?? 'all';

  try {
    if (scope === 'app' && folderId !== session.driveFolderId) {
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
      scope,
      items,
      nextPageToken: response.data.nextPageToken ?? null,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
