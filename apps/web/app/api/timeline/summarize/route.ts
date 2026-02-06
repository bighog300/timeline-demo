import { NextResponse, type NextRequest } from 'next/server';

import { getGoogleAccessToken, getGoogleSession } from '../../../lib/googleAuth';
import { createDriveClient } from '../../../lib/googleDrive';
import { createGmailClient } from '../../../lib/googleGmail';
import { fetchDriveFileText, fetchGmailMessageText } from '../../../lib/fetchSourceText';
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
    return NextResponse.json({ error: 'reconnect_required' }, { status: 401 });
  }

  if (!session.driveFolderId) {
    return NextResponse.json({ error: 'drive_not_provisioned' }, { status: 400 });
  }

  let body: SummarizeRequest | null = null;
  try {
    body = (await request.json()) as SummarizeRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const items = Array.isArray(body?.items) ? body.items.filter(isValidItem) : [];

  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: 'too_many_items' }, { status: 400 });
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
      const artifact: SummaryArtifact = {
        artifactId: `${item.source}:${item.id}`,
        source: item.source,
        sourceId: item.id,
        title: content.title,
        createdAtISO,
        summary,
        highlights,
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
