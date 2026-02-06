import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchDriveFileText, fetchGmailMessageText } from '../../../lib/fetchSourceText';
import { checkRateLimit, getRateLimitKey } from '../../../lib/rateLimit';
import { summarizeDeterministic } from '../../../lib/summarize';
import type { SummaryArtifact } from '../../../lib/types';
import { writeArtifactToDrive } from '../../../lib/writeArtifactToDrive';

type SummarizeRequest = {
  items: Array<{ source: 'gmail' | 'drive'; id: string }>;
};

type FailedItem = {
  source: 'gmail' | 'drive';
  id: string;
  error: string;
};

const MAX_ITEMS = 10;
const PREVIEW_CHARS = 600;

const isValidItem = (value: unknown): value is { source: 'gmail' | 'drive'; id: string } => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as { source?: string; id?: string };
  return (item.source === 'gmail' || item.source === 'drive') && typeof item.id === 'string';
};

export const POST = async (request: NextRequest) => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session || !accessToken) {
    return jsonError(401, 'reconnect_required', 'Reconnect required.');
  }

  if (!session.driveFolderId) {
    return jsonError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
  }

  const rateKey = getRateLimitKey(request, session);
  const rateStatus = checkRateLimit(rateKey, { limit: 10, windowMs: 60_000 });
  if (!rateStatus.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a moment.', {
      retryAfterMs: rateStatus.resetMs,
    });
  }

  let body: SummarizeRequest | null = null;
  try {
    body = (await request.json()) as SummarizeRequest;
  } catch {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  const items = Array.isArray(body?.items) ? body.items.filter(isValidItem) : [];

  if (items.length > MAX_ITEMS) {
    return jsonError(400, 'too_many_items', 'Too many items requested.', {
      limit: MAX_ITEMS,
    });
  }

  const gmail = createGmailClient(accessToken);
  const drive = createDriveClient(accessToken);

  const artifacts: SummaryArtifact[] = [];
  const failed: FailedItem[] = [];

  for (const item of items) {
    try {
      const content =
        item.source === 'gmail'
          ? await fetchGmailMessageText(gmail, item.id)
          : await fetchDriveFileText(drive, item.id);

      const { summary, highlights } = summarizeDeterministic({
        title: content.title,
        text: content.text,
      });

      const createdAtISO = new Date().toISOString();
      const sourcePreview =
        content.text.length > PREVIEW_CHARS
          ? `${content.text.slice(0, PREVIEW_CHARS).trimEnd()}…`
          : content.text;
      const artifact: SummaryArtifact = {
        artifactId: `${item.source}:${item.id}`,
        source: item.source,
        sourceId: item.id,
        title: content.title,
        createdAtISO,
        summary,
        highlights,
        sourceMetadata: content.metadata,
        sourcePreview,
        driveFolderId: session.driveFolderId,
        driveFileId: '',
        driveWebViewLink: undefined,
        model: 'stub',
        version: 1,
      };

      const driveResult = await writeArtifactToDrive(drive, session.driveFolderId, artifact);

      artifacts.push({
        ...artifact,
        driveFileId: driveResult.markdownFileId,
        driveWebViewLink: driveResult.markdownWebViewLink,
      });
    } catch (error) {
      failed.push({
        source: item.source,
        id: item.id,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return NextResponse.json({ artifacts, failed });
};
