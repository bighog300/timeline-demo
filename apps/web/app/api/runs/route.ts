import { NextResponse, type NextRequest } from 'next/server';

import { jsonError } from '../../lib/apiErrors';
import { getGoogleAccessToken, getGoogleSession } from '../../lib/googleAuth';
import { createDriveClient } from '../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../lib/googleRequest';
import { buildRunArtifact, listRunArtifacts, type SelectionSetRunArtifact, writeRunArtifactStart } from '../../lib/runArtifacts';
import { type SelectionSet } from '../../lib/selectionSets';

type RunsCreateRequest = {
  selectionSet?: SelectionSet;
  action?: 'run' | 'summarize';
  caps?: SelectionSetRunArtifact['caps'];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSelectionSet = (value: unknown): value is SelectionSet => {
  if (!isRecord(value) || !isRecord(value.query)) {
    return false;
  }

  return (
    (value.kind === 'gmail_selection_set' || value.kind === 'drive_selection_set') &&
    (value.source === 'gmail' || value.source === 'drive') &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.query.q === 'string'
  );
};

const normalizeCaps = (value: unknown): SelectionSetRunArtifact['caps'] => {
  if (!isRecord(value)) {
    return { maxPages: 1, maxItems: 50, pageSize: 50, batchSize: 10 };
  }

  return {
    maxPages: typeof value.maxPages === 'number' ? value.maxPages : 1,
    maxItems: typeof value.maxItems === 'number' ? value.maxItems : 50,
    pageSize: typeof value.pageSize === 'number' ? value.pageSize : 50,
    batchSize: typeof value.batchSize === 'number' ? value.batchSize : 10,
  };
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

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;
  const drive = createDriveClient(accessToken);

  try {
    const runs = await listRunArtifacts(drive, session.driveFolderId, { limit });
    return NextResponse.json({
      runs: runs.map((run) => ({
        id: run.id,
        action: run.action,
        status: run.result.status,
        selectionSet: run.selectionSet,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        counts: {
          foundCount: run.result.foundCount,
          processedCount: run.result.processedCount,
          failedCount: run.result.failedCount,
        },
        requestIds: run.result.requestIds,
        artifact: run,
      })),
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.list');
    const mapped = mapGoogleError(error, 'drive.files.list');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  if (!isRecord(payload)) {
    return jsonError(400, 'invalid_request', 'Invalid request payload.');
  }

  const typed = payload as RunsCreateRequest;
  if (!isSelectionSet(typed.selectionSet)) {
    return jsonError(400, 'invalid_request', 'selectionSet is required.');
  }

  if (typed.action !== 'run' && typed.action !== 'summarize') {
    return jsonError(400, 'invalid_request', 'action must be run or summarize.');
  }

  const artifact = buildRunArtifact({
    selectionSet: typed.selectionSet,
    action: typed.action,
    startedAt: new Date().toISOString(),
    caps: normalizeCaps(typed.caps),
  });

  const drive = createDriveClient(accessToken);

  try {
    const write = await writeRunArtifactStart(drive, session.driveFolderId, artifact);
    return NextResponse.json({ runId: write.runId, fileId: write.fileId });
  } catch (error) {
    logGoogleError(error, 'drive.files.create');
    const mapped = mapGoogleError(error, 'drive.files.create');
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
