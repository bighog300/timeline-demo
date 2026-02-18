import { randomUUID } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { DriveSelectionSetJsonSchema, type SelectionSetItem } from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../lib/apiErrors';
import { OutsideFolderError } from '../../../../lib/driveSafety';
import { getGoogleAccessToken, getGoogleSession } from '../../../../lib/googleAuth';
import { createDriveClient } from '../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../lib/googleRequest';
import { readSelectionSetFromDrive } from '../../../../lib/readSelectionSetFromDrive';
import { writeSelectionSetToDrive } from '../../../../lib/writeSelectionSetToDrive';
import { loadChatContext } from '../../../../lib/chatContextLoader';

const MAX_CONTEXT_ITEMS = 200;

const ContextSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('recent'),
      recentCount: z.union([z.literal(8), z.literal(20), z.literal(50)]),
      sourceFilter: z.union([z.literal('all'), z.literal('gmail'), z.literal('drive')]).default('all'),
    })
    .strict(),
  z
    .object({
      mode: z.literal('selection_set'),
      selectionSetId: z.string().trim().min(1),
      sourceFilter: z.union([z.literal('all'), z.literal('gmail'), z.literal('drive')]).default('all'),
    })
    .strict(),
]);

const RequestSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    context: ContextSchema,
  })
  .strict();

const parseDateISO = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : undefined;
};

const toSortableTimestamp = (value?: string) => {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dedupeAndCapItems = (items: SelectionSetItem[]) => {
  const sorted = [...items].sort((a, b) => toSortableTimestamp(b.dateISO) - toSortableTimestamp(a.dateISO));

  const deduped: SelectionSetItem[] = [];
  const seen = new Set<string>();

  for (const item of sorted) {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);

    if (deduped.length >= MAX_CONTEXT_ITEMS) {
      break;
    }
  }

  return deduped;
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
    return jsonError(400, 'bad_request', 'Invalid request payload.');
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(400, 'bad_request', 'Invalid request payload.', parsed.error.flatten());
  }

  try {
    const drive = createDriveClient(accessToken);

    if (parsed.data.context.mode === 'selection_set') {
      try {
        const selection = await readSelectionSetFromDrive(
          drive,
          session.driveFolderId,
          parsed.data.context.selectionSetId,
        );
        if (!selection) {
          return jsonError(400, 'bad_request', 'Selection set not found.');
        }
      } catch (error) {
        if (error instanceof OutsideFolderError) {
          return jsonError(403, 'forbidden', 'Selection set is outside this app folder.');
        }

        logGoogleError(error, 'drive.files.get');
        const mapped = mapGoogleError(error, 'drive.files.get');
        return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
      }
    }

    const selection =
      parsed.data.context.mode === 'recent'
        ? {
            mode: 'recent' as const,
            recentCount: parsed.data.context.recentCount,
            sourceFilter: parsed.data.context.sourceFilter,
          }
        : {
            mode: 'selection_set' as const,
            selectionSetId: parsed.data.context.selectionSetId,
            sourceFilter: parsed.data.context.sourceFilter,
            recentCount: 8 as const,
          };

    const context = await loadChatContext({
      drive,
      driveFolderId: session.driveFolderId,
      selection,
    });

    const mappedItems = context.items.map((artifact) => ({
      source: artifact.source,
      id: artifact.sourceId,
      title: artifact.title,
      dateISO: parseDateISO(artifact.dateISO),
    }));

    const items = dedupeAndCapItems(mappedItems);

    if (items.length === 0) {
      return jsonError(400, 'bad_request', 'No artifacts in context to save.');
    }

    const nowISO = new Date().toISOString();
    const selectionSetCandidate = {
      id: randomUUID(),
      name: parsed.data.name,
      createdAtISO: nowISO,
      updatedAtISO: nowISO,
      items,
      version: 1,
      driveFolderId: session.driveFolderId,
      driveFileId: '',
    };

    const validatedSelectionSet = DriveSelectionSetJsonSchema.safeParse(selectionSetCandidate);
    if (!validatedSelectionSet.success) {
      return jsonError(500, 'internal_error', 'Failed to build selection set payload.');
    }

    const write = await writeSelectionSetToDrive(
      drive,
      session.driveFolderId,
      validatedSelectionSet.data,
    );

    return NextResponse.json({
      fileId: write.driveFileId,
      name: parsed.data.name,
      webViewLink: write.driveWebViewLink ?? '',
      count: items.length,
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.create');
    const mapped = mapGoogleError(error, 'drive.files.create');
    if (mapped.status >= 500) {
      return jsonError(500, 'internal_error', 'Failed to create saved selection.');
    }
    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
