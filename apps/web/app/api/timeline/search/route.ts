import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
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
  snippet: string;
  matchFields: string[];
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

const getRequestUrl = (request: NextRequest | Request) =>
  'nextUrl' in request ? request.nextUrl : new URL(request.url);

export const GET = async (request: NextRequest | Request) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  if (!session.driveFolderId) {
    return NextResponse.json({ error: 'drive_not_provisioned' }, { status: 400 });
  }

  const url = getRequestUrl(request);
  const qParam = url.searchParams.get('q') ?? '';
  const trimmedQuery = qParam.trim();

  if (trimmedQuery.length < 2) {
    return NextResponse.json({ error: 'query_too_short' }, { status: 400 });
  }

  if (trimmedQuery.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: 'query_too_long' }, { status: 400 });
  }

  const type = parseType(url.searchParams.get('type'));
  const pageToken = url.searchParams.get('pageToken') ?? undefined;
  const rawPageSize = Number(url.searchParams.get('pageSize'));
  const safePageSize = Number.isFinite(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(safePageSize, 1), MAX_PAGE_SIZE);

  const drive = createDriveClient(accessToken);
  const response = await drive.files.list({
    q: buildDriveQuery(session.driveFolderId, type),
    orderBy: 'modifiedTime desc',
    pageSize,
    pageToken,
    fields: 'nextPageToken, files(id, name, modifiedTime, webViewLink)',
  });

  const candidates = (response.data.files ?? []).filter((file) => file.id);
  const matches: SearchResult[] = [];
  const normalizedQuery = normalizeQuery(trimmedQuery);

  for (const file of candidates.slice(0, DOWNLOAD_CAP)) {
    const kind = fileKind(file.name ?? undefined);
    if (!kind || (type !== 'all' && kind !== type)) {
      continue;
    }

    const contentResponse = await drive.files.get(
      { fileId: file.id ?? '', alt: 'media' },
      { responseType: 'json' },
    );
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
    nextPageToken: response.data.nextPageToken ?? undefined,
    partial: candidates.length > DOWNLOAD_CAP ? true : undefined,
  });
};
