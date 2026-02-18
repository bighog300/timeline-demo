import { NextResponse, type NextRequest } from 'next/server';
import {
  DriveSelectionSetJsonSchema,
  SelectionSetItemSchema,
  type DriveSelectionSetJson,
  type SelectionSetItem,
} from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../../lib/apiErrors';
import { OutsideFolderError } from '../../../../../lib/driveSafety';
import { getGoogleAccessToken, getGoogleSession } from '../../../../../lib/googleAuth';
import { createDriveClient } from '../../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../../lib/googleRequest';
import { readSelectionSetFromDrive } from '../../../../../lib/readSelectionSetFromDrive';
import { loadChatContext } from '../../../../../lib/chatContextLoader';

const MAX_ITEMS = 500;

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
    context: ContextSchema,
  })
  .strict();

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

const parseDateISO = (value?: string) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : undefined;
};

const toSortableTimestamp = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapContextItems = (items: Array<{ source: 'gmail' | 'drive'; sourceId: string; title: string; dateISO?: string }>) =>
  items
    .map((artifact) =>
      SelectionSetItemSchema.parse({
        source: artifact.source,
        id: artifact.sourceId,
        title: artifact.title,
        dateISO: parseDateISO(artifact.dateISO),
      }),
    );

const mergeItems = (
  existingItems: SelectionSetItem[],
  incomingItems: SelectionSetItem[],
): { merged: SelectionSetItem[]; added: number; skippedDuplicates: number } => {
  const byKey = new Map<string, SelectionSetItem>();

  for (const item of existingItems) {
    byKey.set(`${item.source}:${item.id}`, item);
  }

  let added = 0;
  let skippedDuplicates = 0;

  for (const incoming of incomingItems) {
    const key = `${incoming.source}:${incoming.id}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, incoming);
      added += 1;
      continue;
    }

    skippedDuplicates += 1;
    byKey.set(key, {
      ...incoming,
      ...existing,
      title: existing.title ?? incoming.title,
      dateISO: existing.dateISO ?? incoming.dateISO,
    });
  }

  const merged = [...byKey.values()]
    .sort((a, b) => toSortableTimestamp(b.dateISO) - toSortableTimestamp(a.dateISO))
    .slice(0, MAX_ITEMS);

  return { merged, added, skippedDuplicates };
};

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) => {
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

  const parsedRequest = RequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return jsonError(400, 'bad_request', 'Invalid request payload.', parsedRequest.error.flatten());
  }

  try {
    const { fileId } = await params;
    const drive = createDriveClient(accessToken);

    const metadata = await drive.files.get({ fileId, fields: 'id, name, parents, webViewLink' });
    if (!metadata.data.id) {
      return jsonError(404, 'not_found', 'Selection set not found.');
    }

    const parents = metadata.data.parents ?? [];
    if (!parents.includes(session.driveFolderId)) {
      return jsonError(403, 'forbidden', 'Selection set is not in the app folder.');
    }

    const content = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json' });
    const parsedSelection = DriveSelectionSetJsonSchema.safeParse(parseDriveJson(content.data));
    if (!parsedSelection.success) {
      return jsonError(500, 'internal_error', 'Selection set payload is invalid.');
    }

    if (parsedSelection.data.driveFolderId !== session.driveFolderId) {
      return jsonError(403, 'forbidden', 'Selection set is not in the app folder.');
    }

    if (parsedRequest.data.context.mode === 'selection_set') {
      try {
        const sourceSelection = await readSelectionSetFromDrive(
          drive,
          session.driveFolderId,
          parsedRequest.data.context.selectionSetId,
        );
        if (!sourceSelection) {
          return jsonError(400, 'bad_request', 'No artifacts in context to add.');
        }
      } catch (error) {
        if (error instanceof OutsideFolderError) {
          return jsonError(403, 'forbidden', 'Selection set is not in the app folder.');
        }
        throw error;
      }
    }

    const contextSelection =
      parsedRequest.data.context.mode === 'recent'
        ? {
            mode: 'recent' as const,
            recentCount: parsedRequest.data.context.recentCount,
            sourceFilter: parsedRequest.data.context.sourceFilter,
          }
        : {
            mode: 'selection_set' as const,
            selectionSetId: parsedRequest.data.context.selectionSetId,
            sourceFilter: parsedRequest.data.context.sourceFilter,
            recentCount: 8 as const,
          };

    const context = await loadChatContext({
      drive,
      driveFolderId: session.driveFolderId,
      selection: contextSelection,
    });

    const newItems = mapContextItems(context.items);
    if (newItems.length === 0) {
      return jsonError(400, 'bad_request', 'No artifacts in context to add.');
    }

    const { merged, added, skippedDuplicates } = mergeItems(parsedSelection.data.items, newItems);

    const nextSelection: DriveSelectionSetJson & { itemCount?: number } = {
      ...parsedSelection.data,
      items: merged,
      updatedAtISO: new Date().toISOString(),
      ...(typeof (parsedSelection.data as { itemCount?: unknown }).itemCount === 'number'
        ? { itemCount: merged.length }
        : {}),
    };

    const validatedFinal = DriveSelectionSetJsonSchema.safeParse(nextSelection);
    if (!validatedFinal.success) {
      return jsonError(500, 'internal_error', 'Failed to update selection set payload.');
    }

    const serialized = JSON.stringify(validatedFinal.data, null, 2);
    const update = await drive.files.update({
      fileId,
      media: { mimeType: 'application/json', body: serialized },
      fields: 'id, name, webViewLink',
    });

    return NextResponse.json({
      fileId,
      name: update.data.name ?? metadata.data.name ?? validatedFinal.data.name,
      count: merged.length,
      added,
      skippedDuplicates,
      webViewLink: update.data.webViewLink ?? metadata.data.webViewLink ?? '',
    });
  } catch (error) {
    logGoogleError(error, 'drive.files.update');
    const mapped = mapGoogleError(error, 'drive.files.update');

    if (mapped.status === 404) {
      return jsonError(404, 'not_found', 'Selection set not found.');
    }

    if (mapped.status >= 500) {
      return jsonError(500, 'internal_error', 'Failed to add artifacts to saved selection.');
    }

    return jsonError(mapped.status, mapped.code, mapped.message, mapped.details);
  }
};
