import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import type { SummaryArtifact } from '../../../../lib/types';
import { isSummaryArtifact, normalizeArtifact } from '../../../../lib/validateArtifact';

const DEFAULT_PAGE_SIZE = 50;
const MAX_JSON_DOWNLOADS = 20;

type ArtifactFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const isArtifactJson = (file: { name?: string | null; mimeType?: string | null }) => {
  const name = file.name ?? '';
  const hasSummaryName = name.includes(' - Summary.json');
  const hasJsonSuffix = name.endsWith(' - Summary.json');
  return hasSummaryName || (file.mimeType === 'application/json' && hasJsonSuffix);
};

const parseDriveJson = (data: unknown): unknown => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
};

export const GET = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  if (!session.driveFolderId) {
    return NextResponse.json({ error: 'drive_not_provisioned' }, { status: 400 });
  }

  const pageToken = request.nextUrl.searchParams.get('pageToken') ?? undefined;
  const pageSize = Number(request.nextUrl.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE;

  const drive = createDriveClient(accessToken);

  const listResponse = await drive.files.list({
    q: `'${session.driveFolderId}' in parents and trashed=false`,
    orderBy: 'modifiedTime desc',
    pageSize,
    pageToken,
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
  });

  const files = (listResponse.data.files ?? []).filter(isArtifactJson);
  const responseFiles: ArtifactFile[] = files.map((file) => ({
    id: file.id ?? '',
    name: file.name ?? 'Untitled Summary',
    modifiedTime: file.modifiedTime ?? undefined,
    webViewLink: file.webViewLink ?? undefined,
  }));

  const artifacts: SummaryArtifact[] = [];
  for (const file of files.slice(0, MAX_JSON_DOWNLOADS)) {
    if (!file.id) {
      continue;
    }

    try {
      const contentResponse = await drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'json' },
      );
      const parsed = parseDriveJson(contentResponse.data);

      if (isSummaryArtifact(parsed)) {
        const normalized = normalizeArtifact(parsed);
        artifacts.push({
          ...normalized,
          driveFileId: normalized.driveFileId || file.id,
          driveWebViewLink: normalized.driveWebViewLink ?? file.webViewLink ?? undefined,
        });
      } else {
        console.warn('Skipping invalid summary artifact JSON', { fileId: file.id });
      }
    } catch (error) {
      console.warn('Failed to read summary artifact JSON', {
        fileId: file.id,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return NextResponse.json({
    artifacts,
    files: responseFiles,
    nextPageToken: listResponse.data.nextPageToken ?? undefined,
  });
};
