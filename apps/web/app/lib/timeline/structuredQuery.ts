import {
  StructuredQueryRequestSchema,
  StructuredQueryResponseSchema,
  SummaryArtifactSchema,
  SynthesisArtifactSchema,
  type ArtifactIndex,
  type ArtifactIndexEntry,
  type StructuredQueryRequest,
} from '@timeline/shared';
import type { drive_v3 } from 'googleapis';

import { normalizeEntityName } from '../entities/normalizeEntity';
import type { EntityAliases } from '../entities/aliases';

const toTs = (value?: string) => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
};

const isInRange = (value: string | undefined, from?: string, to?: string) => {
  if (!value) return true;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return true;
  if (from && ts < new Date(from).getTime()) return false;
  if (to && ts > new Date(to).getTime()) return false;
  return true;
};

const parseArtifact = (value: unknown) => {
  const synthesis = SynthesisArtifactSchema.safeParse(value);
  if (synthesis.success) return { kind: 'synthesis' as const, artifact: synthesis.data };
  const summary = SummaryArtifactSchema.safeParse(value);
  if (summary.success) return { kind: 'summary' as const, artifact: summary.data };
  return null;
};

const parseJson = (input: unknown): unknown => {
  if (typeof input !== 'string') return input;
  try { return JSON.parse(input) as unknown; } catch { return null; }
};

const resolveEntity = (entity: string | undefined, aliases?: EntityAliases) => {
  if (!entity) return undefined;
  const normalized = normalizeEntityName(entity);
  const match = aliases?.aliases.find((row) => row.alias === normalized);
  return match?.canonical ?? normalized;
};

const indexPrefilter = (entries: ArtifactIndexEntry[], query: StructuredQueryRequest, canonicalEntity?: string) => entries
  .filter((entry) => isInRange(entry.contentDateISO, query.dateFromISO, query.dateToISO))
  .filter((entry) => !query.kind?.length || (entry.kind ? query.kind.includes(entry.kind) : query.kind.includes('summary')))
  .filter((entry) => {
    if (!canonicalEntity) return true;
    const names = new Set((entry.entities ?? []).map((item) => normalizeEntityName(item.name)));
    return names.has(canonicalEntity);
  })
  .filter((entry) => (typeof query.hasOpenLoops === 'boolean' ? query.hasOpenLoops ? (entry.openLoopsCount ?? 0) > 0 : (entry.openLoopsCount ?? 0) === 0 : true))
  .filter((entry) => (typeof query.hasRisks === 'boolean' ? query.hasRisks ? (entry.risksCount ?? 0) > 0 : (entry.risksCount ?? 0) === 0 : true))
  .filter((entry) => (typeof query.hasDecisions === 'boolean' ? query.hasDecisions ? (entry.decisionsCount ?? 0) > 0 : (entry.decisionsCount ?? 0) === 0 : true))
  .filter((entry) => {
    if (!query.tags?.length) return true;
    const tags = new Set((entry.tags ?? []).map((tag) => tag.toLowerCase()));
    return query.tags.some((tag) => tags.has(tag.toLowerCase()));
  })
  .filter((entry) => {
    if (!query.participants?.length) return true;
    const participants = new Set((entry.participants ?? []).map((item) => item.toLowerCase()));
    return query.participants.some((item) => participants.has(item.toLowerCase()));
  })
  .sort((a, b) => {
    const byContent = toTs(b.contentDateISO) - toTs(a.contentDateISO);
    if (byContent !== 0) return byContent;
    return toTs(b.updatedAtISO) - toTs(a.updatedAtISO);
  });

export const runStructuredQuery = async ({
  drive,
  index,
  input,
  aliases,
  scanBuffer = 10,
}: {
  drive: drive_v3.Drive;
  index: ArtifactIndex;
  input: unknown;
  aliases?: EntityAliases;
  scanBuffer?: number;
}) => {
  const query = StructuredQueryRequestSchema.parse(input);
  const canonicalEntity = resolveEntity(query.entity, aliases);
  const normalizedQuery = { ...query, ...(canonicalEntity ? { entity: canonicalEntity } : {}) };

  const pref = indexPrefilter(index.artifacts, normalizedQuery, canonicalEntity);
  const scanCap = Math.min(pref.length, query.limitArtifacts + scanBuffer);

  const results: Array<{
    artifactId: string;
    kind?: 'summary' | 'synthesis';
    title?: string;
    contentDateISO?: string;
    entities?: Array<{ name: string; type?: 'person' | 'org' | 'project' | 'product' | 'place' | 'other' }>;
    matches: {
      openLoops?: Array<{ text: string; owner?: string | null; dueDateISO?: string | null; status?: 'open' | 'closed'; closedAtISO?: string | null; closedReason?: string | null; sourceActionId?: string | null; confidence?: number | null }>;
      risks?: Array<{ text: string; severity?: 'low' | 'medium' | 'high'; likelihood?: 'low' | 'medium' | 'high'; owner?: string | null; mitigation?: string | null; confidence?: number | null }>;
      decisions?: Array<{ text: string; dateISO?: string | null; owner?: string | null; confidence?: number | null }>;
    };
  }> = [];

  let openLoopsMatched = 0;
  let risksMatched = 0;
  let decisionsMatched = 0;

  for (const entry of pref.slice(0, scanCap)) {
    const raw = await drive.files.get({ fileId: entry.driveFileId, alt: 'media' }, { responseType: 'json' });
    const parsed = parseArtifact(parseJson(raw.data));
    if (!parsed) continue;

    const openLoops = (parsed.artifact.openLoops ?? [])
      .filter((loop) => (query.openLoopStatus ? (loop.status ?? 'open') === query.openLoopStatus : true))
      .filter((loop) => isInRange(loop.dueDateISO ?? undefined, query.openLoopDueFromISO, query.openLoopDueToISO));

    const risks = (parsed.artifact.risks ?? []).filter((risk) => (query.riskSeverity ? risk.severity === query.riskSeverity : true));
    const decisions = (parsed.artifact.decisions ?? []).filter((decision) =>
      isInRange(decision.dateISO ?? undefined, query.decisionFromISO, query.decisionToISO),
    );

    if (typeof query.hasOpenLoops === 'boolean') {
      if (query.hasOpenLoops && openLoops.length === 0) continue;
      if (!query.hasOpenLoops && openLoops.length > 0) continue;
    }
    if (typeof query.hasRisks === 'boolean') {
      if (query.hasRisks && risks.length === 0) continue;
      if (!query.hasRisks && risks.length > 0) continue;
    }
    if (typeof query.hasDecisions === 'boolean') {
      if (query.hasDecisions && decisions.length === 0) continue;
      if (!query.hasDecisions && decisions.length > 0) continue;
    }

    const limitedOpen = openLoops.slice(0, query.limitItemsPerArtifact);
    const limitedRisks = risks.slice(0, query.limitItemsPerArtifact);
    const limitedDecisions = decisions.slice(0, query.limitItemsPerArtifact);

    openLoopsMatched += openLoops.length;
    risksMatched += risks.length;
    decisionsMatched += decisions.length;

    results.push({
      artifactId: parsed.kind === 'summary' ? parsed.artifact.artifactId : parsed.artifact.id,
      kind: parsed.kind,
      title: parsed.artifact.title,
      contentDateISO: parsed.artifact.contentDateISO,
      entities: parsed.artifact.entities,
      matches: {
        ...(limitedOpen.length ? { openLoops: limitedOpen } : {}),
        ...(limitedRisks.length ? { risks: limitedRisks } : {}),
        ...(limitedDecisions.length ? { decisions: limitedDecisions } : {}),
      },
    });

    if (results.length >= query.limitArtifacts) break;
  }

  return StructuredQueryResponseSchema.parse({
    ok: true,
    query: normalizedQuery,
    totals: {
      artifactsMatched: results.length,
      openLoopsMatched,
      risksMatched,
      decisionsMatched,
    },
    results,
  });
};
