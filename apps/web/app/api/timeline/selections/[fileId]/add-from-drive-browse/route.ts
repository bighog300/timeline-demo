import { type NextRequest, NextResponse } from 'next/server';
import {
  DriveSelectionSetJsonSchema,
  SelectionSetItemSchema,
  type DriveSelectionSetJson,
  type SelectionSetItem,
} from '@timeline/shared';
import { z } from 'zod';

import { jsonError } from '../../../../../lib/apiErrors';
import { MIME_GROUP_SCHEMA, resolveDriveSelection, SCOPE_SCHEMA } from '../../../../../lib/driveBrowseSelection';
import { getGoogleAccessToken, getGoogleSession } from '../../../../../lib/googleAuth';
import { createDriveClient } from '../../../../../lib/googleDrive';
import { logGoogleError, mapGoogleError } from '../../../../../lib/googleRequest';

const MAX_ITEMS = 500;

const RequestSchema = z.object({
  scope: SCOPE_SCHEMA,
  picked: z.array(z.object({ id: z.string().trim().min(1), isFolder: z.boolean() }).strict()).min(1),
  mimeGroup: MIME_GROUP_SCHEMA,
  limit: z.number().int().min(1).max(500).optional(),
}).strict();

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

const parseDateISO = (value?: string | null) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : undefined;
};

const toSortableTimestamp = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mergeItems = (
  existingItems: SelectionSetItem[],
  incomingItems: SelectionSetItem[],
): { merged: SelectionSetItem[]; added: number; skippedDuplicates: number; truncated: boolean } => {
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

  const sorted = [...byKey.values()].sort((a, b) => toSortableTimestamp(b.dateISO) - toSortableTimestamp(a.dateISO));
  const merged = sorted.slice(0, MAX_ITEMS);

  return { merged, added, skippedDuplicates, truncated: sorted.length > MAX_ITEMS };
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

    if (!(metadata.data.parents ?? []).includes(session.driveFolderId)) {
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

    const limit = parsedRequest.data.limit ?? 200;
    const resolved = await resolveDriveSelection({
      accessToken,
      driveFolderId: session.driveFolderId,
      scope: parsedRequest.data.scope,
      picked: parsedRequest.data.picked,
      mimeGroup: parsedRequest.data.mimeGroup,
      limit,
      dryRun: false,
    });

    const nowISO = new Date().toISOString();
    const incoming = resolved.files.map((file) =>
      SelectionSetItemSchema.parse({
        source: 'drive',
        id: file.id,
        title: file.name,
        dateISO: parseDateISO(file.modifiedTime) ?? nowISO,
      }),
    );

    const { merged, added, skippedDuplicates, truncated } = mergeItems(parsedSelection.data.items, incoming);

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
      added,
      skippedDuplicates,
      count: merged.length,
      truncated: truncated || resolved.truncated,
      fileId,
      name: update.data.name ?? metadata.data.name ?? validatedFinal.data.name,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'ITEM_OUTSIDE_APP_SCOPE') {
      return jsonError(403, 'forbidden', 'Item is outside the app Drive scope.');
    }

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
