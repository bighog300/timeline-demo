import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../../lib/googleRequest';
import { checkRateLimit, getRateLimitKey } from '../../../../lib/rateLimit';
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
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 60, windowMs: 60_000 });
  if (!rateStatus.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
      retryAfterMs: rateStatus.resetMs,
    });
  }

  const pageToken = request.nextUrl.searchParams.get('pageToken') ?? undefined;
  const pageSize = Number(request.nextUrl.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE;

  const drive = createDriveClient(accessToken);

  let listResponse;
  try {
    listResponse = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.list(
            {
              q: `'${session.driveFolderId}' in parents and trashed=false`,
              orderBy: 'modifiedTime desc',
              pageSize,
              pageToken,
              fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
            },
            { signal: timeoutSignal },
          ),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    );
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

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
    const fileId = file.id;

    try {
      const contentResponse = await withRetry((signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.get({ fileId, alt: 'media' }, {
              responseType: 'json',
              signal: timeoutSignal,
            }),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
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
