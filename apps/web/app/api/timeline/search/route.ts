import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import {
  DEFAULT_GOOGLE_TIMEOUT_MS,
  logGoogleError,
  mapGoogleError,
  withRetry,
  withTimeout,
} from '../../../lib/googleRequest';
import { DEFAULT_INDEX_MAX_AGE_MINUTES, isIndexFresh } from '../../../lib/indexFreshness';
import { findIndexFile, readIndexFile } from '../../../lib/indexDrive';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { matchSelectionSet, matchSummaryArtifact, normalizeQuery } from '../../../lib/searchIndex';
import { isSummaryArtifact, normalizeArtifact } from '../../../lib/validateArtifact';
import { isSelectionSet, normalizeSelectionSet } from '../../../lib/validateSelectionSet';

type SearchType = 'all' | 'summary' | 'selection';

type SearchResult = {
  kind: 'summary' | 'selection';
  driveFileId: string;
  driveWebViewLink?: string;
  title: string;
  updatedAtISO?: string;
  source?: 'gmail' | 'drive';
  sourceId?: string;
  createdAtISO?: string;
  snippet: string;
  matchFields: string[];
};

type DriveCandidate = {
  id: string;
  name?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const MAX_QUERY_LENGTH = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const DOWNLOAD_CAP = 20;

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

const parseType = (value: string | null): SearchType => {
  if (value === 'summary' || value === 'selection' || value === 'all') {
    return value;
  }
  return 'all';
};

const buildDriveQuery = (folderId: string, type: SearchType) => {
  const base = `'${folderId}' in parents and trashed=false`;
  if (type === 'summary') {
    return `${base} and name contains ' - Summary.json'`;
  }
  if (type === 'selection') {
    return `${base} and name contains ' - Selection.json'`;
  }
  return `${base} and (name contains ' - Summary.json' or name contains ' - Selection.json')`;
};

const fileKind = (name?: string): 'summary' | 'selection' | null => {
  if (!name) {
    return null;
  }
  const lowered = name.toLowerCase();
  if (lowered.includes(' - summary.json')) {
    return 'summary';
  }
  if (lowered.includes(' - selection.json')) {
    return 'selection';
  }
  return null;
};

const sortByUpdated = (a?: string, b?: string) => {
  const aTime = a ? new Date(a).getTime() : 0;
  const bTime = b ? new Date(b).getTime() : 0;
  return bTime - aTime;
};

const getRequestUrl = (request: NextRequest | Request) =>
  'nextUrl' in request ? request.nextUrl : new URL(request.url);

export const GET = async (request: NextRequest | Request) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }
  const driveFolderId = session.driveFolderId;

  const url = getRequestUrl(request);
  const qParam = url.searchParams.get('q') ?? '';
  const trimmedQuery = qParam.trim();

  if (trimmedQuery.length < 2) {
    return jsonError(400, 'query_too_short', 'Query must be at least 2 characters.');
  }

  if (trimmedQuery.length > MAX_QUERY_LENGTH) {
    return jsonError(400, 'invalid_request', 'Query must be shorter than 100 characters.');
  }

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 60, windowMs: 60_000 });
  if (!rateStatus.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
      retryAfterMs: rateStatus.resetMs,
    });
  }

  const type = parseType(url.searchParams.get('type'));
  const pageToken = url.searchParams.get('pageToken') ?? undefined;
  const rawPageSize = Number(url.searchParams.get('pageSize'));
  const safePageSize = Number.isFinite(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(safePageSize, 1), MAX_PAGE_SIZE);

  const drive = createDriveClient(accessToken);
  let candidates: DriveCandidate[] = [];
  let nextPageToken: string | undefined;
  let fromIndex = false;
  let indexStale = false;

  try {
    const indexFile = await findIndexFile(drive, driveFolderId);
    if (indexFile?.id) {
      const index = await readIndexFile(drive, indexFile.id, driveFolderId);
      if (index) {
        fromIndex = true;
        indexStale = !isIndexFresh(index, new Date(), DEFAULT_INDEX_MAX_AGE_MINUTES);
        const source =
          type === 'summary'
            ? index.summaries
            : type === 'selection'
              ? index.selectionSets
              : [...index.summaries, ...index.selectionSets].sort((a, b) =>
                  sortByUpdated(a.updatedAtISO, b.updatedAtISO),
                );
        const mapped = source.map((entry) =>
          'title' in entry
            ? {
                id: entry.driveFileId,
                name: `${entry.title} - Summary.json`,
                modifiedTime: entry.updatedAtISO,
                webViewLink: entry.webViewLink,
              }
            : {
                id: entry.driveFileId,
                name: `${entry.name} - Selection.json`,
                modifiedTime: entry.updatedAtISO,
                webViewLink: entry.webViewLink,
              },
        );
        const startIndex = pageToken ? Number(pageToken) : 0;
        const safeStartIndex = Number.isFinite(startIndex) && startIndex >= 0 ? startIndex : 0;
        candidates = mapped.slice(safeStartIndex, safeStartIndex + pageSize);
        nextPageToken =
          safeStartIndex + pageSize < mapped.length ? String(safeStartIndex + pageSize) : undefined;
      }
    }
  } catch (error) {
    logGoogleError(error, 'drive.files.get');
    const mapped = mapGoogleError(error, 'drive.files.get');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }

  if (!fromIndex) {
    let response;
    try {
      response = await withRetry((signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.list(
              {
                q: buildDriveQuery(driveFolderId, type),
                orderBy: 'modifiedTime desc',
                pageSize,
                pageToken,
                fields: 'nextPageToken, files(id, name, modifiedTime, webViewLink)',
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

    candidates = (response.data.files ?? []).filter((file) => file.id) as DriveCandidate[];
    nextPageToken = response.data.nextPageToken ?? undefined;
  }
  const matches: SearchResult[] = [];
  const normalizedQuery = normalizeQuery(trimmedQuery);

  for (const file of candidates.slice(0, DOWNLOAD_CAP)) {
    const kind = fileKind(file.name ?? undefined);
    if (!kind || (type !== 'all' && kind !== type)) {
      continue;
    }

    let contentResponse;
    try {
      contentResponse = await withRetry((signal) =>
        withTimeout(
          (timeoutSignal) =>
            drive.files.get(
              { fileId: file.id ?? '', alt: 'media' },
              { responseType: 'json', signal: timeoutSignal },
            ),
          DEFAULT_GOOGLE_TIMEOUT_MS,
          'upstream_timeout',
          signal,
        ),
      );
    } catch (error) {
      logGoogleError(error, 'drive.files.get');
      const mapped = mapGoogleError(error, 'drive.files.get');
      return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
    }
    const parsed = parseDriveJson(contentResponse.data);

    if (kind === 'summary' && isSummaryArtifact(parsed)) {
      const normalized = normalizeArtifact(parsed);
      const match = matchSummaryArtifact(normalized, normalizedQuery);
      if (match.matched) {
        matches.push({
          kind,
          driveFileId: file.id ?? normalized.driveFileId,
          driveWebViewLink: file.webViewLink ?? normalized.driveWebViewLink ?? undefined,
          title: normalized.title,
          updatedAtISO: file.modifiedTime ?? normalized.createdAtISO,
          source: normalized.source,
          sourceId: normalized.sourceId,
          createdAtISO: normalized.createdAtISO,
          snippet: match.snippet,
          matchFields: match.fields,
        });
      }
    }

    if (kind === 'selection' && isSelectionSet(parsed)) {
      const normalized = normalizeSelectionSet(parsed);
      const match = matchSelectionSet(normalized, normalizedQuery);
      if (match.matched) {
        matches.push({
          kind,
          driveFileId: file.id ?? normalized.driveFileId,
          driveWebViewLink: file.webViewLink ?? normalized.driveWebViewLink ?? undefined,
          title: normalized.name,
          updatedAtISO: file.modifiedTime ?? normalized.updatedAtISO,
          snippet: match.snippet,
          matchFields: match.fields,
        });
      }
    }
  }

  return NextResponse.json({
    q: trimmedQuery,
    type,
    results: matches,
    nextPageToken,
    partial: candidates.length > DOWNLOAD_CAP ? true : undefined,
    fromIndex,
    indexStale: fromIndex ? indexStale : undefined,
  });
};
