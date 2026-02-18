import { z } from 'zod';
import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../googleRequest';
import type { LogContext } from '../logger';
import { normalizeEntityName } from './normalizeEntity';

const ENTITY_ALIASES_FILENAME = 'entity_aliases.json';

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

const EntityTypeSchema = z.enum(['person', 'org', 'project', 'product', 'place', 'other']);

const AliasRowSchema = z.object({
  alias: z.string().trim().min(1).max(80),
  canonical: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(80).optional(),
  type: EntityTypeSchema.optional(),
}).strict();

export const EntityAliasesSchema = z.object({
  version: z.literal(1),
  updatedAtISO: z.string().datetime(),
  aliases: z.array(AliasRowSchema),
}).strict();

export type EntityAliases = z.infer<typeof EntityAliasesSchema>;

export const defaultEntityAliases = (): EntityAliases => ({
  version: 1,
  updatedAtISO: new Date().toISOString(),
  aliases: [],
});

const normalizeAliasRow = (row: z.infer<typeof AliasRowSchema>) => ({
  alias: normalizeEntityName(row.alias),
  canonical: normalizeEntityName(row.canonical),
  ...(row.displayName ? { displayName: row.displayName.trim() } : {}),
  ...(row.type ? { type: row.type } : {}),
});

export const normalizeEntityAliases = (input: unknown): EntityAliases | null => {
  const parsed = EntityAliasesSchema.safeParse(input);
  if (!parsed.success) return null;

  const deduped = new Map<string, z.infer<typeof AliasRowSchema>>();
  parsed.data.aliases.forEach((row) => {
    const normalized = normalizeAliasRow(row);
    if (!normalized.alias || !normalized.canonical || normalized.alias === normalized.canonical) return;
    deduped.set(`${normalized.alias}:${normalized.canonical}:${normalized.type ?? ''}`, normalized);
  });

  return {
    version: 1,
    updatedAtISO: new Date().toISOString(),
    aliases: Array.from(deduped.values()),
  };
};

export const findEntityAliasesFile = async (drive: drive_v3.Drive, folderId: string, ctx?: LogContext) => {
  const listed = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.list({
          q: `'${folderId}' in parents and trashed=false and name='${ENTITY_ALIASES_FILENAME}'`,
          pageSize: 1,
          fields: 'files(id, webViewLink)',
        }, { signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  { ctx });

  const file = listed.data.files?.[0];
  return file?.id ? { id: file.id, webViewLink: file.webViewLink ?? undefined } : null;
};

export const readEntityAliasesFromDrive = async (drive: drive_v3.Drive, folderId: string, ctx?: LogContext) => {
  const file = await findEntityAliasesFile(drive, folderId, ctx);
  if (!file) {
    return { aliases: defaultEntityAliases(), fileId: undefined as string | undefined, webViewLink: undefined as string | undefined };
  }

  const response = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'json', signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  { ctx });

  const normalized = normalizeEntityAliases(parseDriveJson(response.data));
  return {
    aliases: normalized ?? defaultEntityAliases(),
    fileId: file.id,
    webViewLink: file.webViewLink,
  };
};

export const writeEntityAliasesToDrive = async (
  drive: drive_v3.Drive,
  folderId: string,
  existingFileId: string | null,
  aliases: EntityAliases,
  ctx?: LogContext,
) => {
  const payload = JSON.stringify({ ...aliases, updatedAtISO: new Date().toISOString() }, null, 2);

  if (existingFileId) {
    const updated = await withRetry((signal) =>
      withTimeout(
        (timeoutSignal) =>
          drive.files.update({
            fileId: existingFileId,
            media: { mimeType: 'application/json', body: payload },
            fields: 'id, webViewLink',
          }, { signal: timeoutSignal }),
        DEFAULT_GOOGLE_TIMEOUT_MS,
        'upstream_timeout',
        signal,
      ),
    { ctx });
    return { fileId: updated.data.id ?? existingFileId, webViewLink: updated.data.webViewLink ?? undefined };
  }

  const created = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create({
          requestBody: { name: ENTITY_ALIASES_FILENAME, parents: [folderId], mimeType: 'application/json' },
          media: { mimeType: 'application/json', body: payload },
          fields: 'id, webViewLink',
        }, { signal: timeoutSignal }),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  { ctx });

  return { fileId: created.data.id ?? '', webViewLink: created.data.webViewLink ?? undefined };
};

export const canonicalizeEntities = (
  entities: Array<{ name: string; type?: 'person' | 'org' | 'project' | 'product' | 'place' | 'other' }> | undefined,
  aliasConfig: EntityAliases,
) => {
  if (!entities?.length) return [];
  const byAlias = new Map(aliasConfig.aliases.map((row) => [row.alias, row]));

  const deduped = new Map<string, { name: string; type?: 'person' | 'org' | 'project' | 'product' | 'place' | 'other' }>();
  entities.forEach((entity) => {
    const normalized = normalizeEntityName(entity.name);
    if (!normalized) return;
    const mapped = byAlias.get(normalized);
    const canonical = mapped?.canonical ?? normalized;
    const type = mapped?.type ?? entity.type;
    const key = `${canonical}:${type ?? ''}`;
    if (!deduped.has(key)) {
      deduped.set(key, { name: mapped?.displayName ?? canonical, ...(type ? { type } : {}) });
    }
  });

  return Array.from(deduped.values());
};
