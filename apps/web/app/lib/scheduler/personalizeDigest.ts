import type { ArtifactIndex, StructuredQueryRequest } from '@timeline/shared';
import type { drive_v3 } from 'googleapis';

import type { EntityAliases } from '../entities/aliases';
import { normalizeEntityName } from '../entities/normalizeEntity';
import { loadArtifactIndex } from '../timeline/artifactIndex';
import { runStructuredQuery } from '../timeline/structuredQuery';

type ProfileFilters = {
  entities?: string[];
  tags?: string[];
  participants?: string[];
  kind?: Array<'summary' | 'synthesis'>;
  riskSeverityMin?: 'low' | 'medium' | 'high';
  includeOpenLoops?: boolean;
  includeRisks?: boolean;
  includeDecisions?: boolean;
  includeActions?: boolean;
};

type RecipientProfile = {
  id: string;
  name?: string;
  to: string[];
  cc?: string[];
  filters: ProfileFilters;
};

const severityRanks = { low: 1, medium: 2, high: 3 } as const;

const canonicalizeEntity = (value: string, aliases?: EntityAliases) => {
  const normalized = normalizeEntityName(value);
  const match = aliases?.aliases.find((row) => row.alias === normalized);
  return match?.canonical ?? normalized;
};

const unique = (items: string[] | undefined) => Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean)));

export const normalizeProfileFilters = (filters: ProfileFilters, aliasMap?: EntityAliases): ProfileFilters => ({
  ...filters,
  entities: unique(filters.entities).map((entity) => canonicalizeEntity(entity, aliasMap)),
  tags: unique(filters.tags).map((tag) => tag.toLowerCase()),
  participants: unique(filters.participants).map((participant) => participant.toLowerCase()),
  includeOpenLoops: filters.includeOpenLoops !== false,
  includeRisks: filters.includeRisks !== false,
  includeDecisions: filters.includeDecisions !== false,
  includeActions: filters.includeActions !== false,
});

const riskSeverities = (min?: 'low' | 'medium' | 'high') => {
  if (!min) return undefined;
  const threshold = severityRanks[min];
  return (['low', 'medium', 'high'] as const).filter((severity) => severityRanks[severity] >= threshold);
};

const timelineLink = (filters: ProfileFilters) => {
  const params = new URLSearchParams();
  if (filters.entities?.[0]) params.set('entity', filters.entities[0]);
  if (filters.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters.participants?.length) params.set('participants', filters.participants.join(','));
  if (filters.kind?.length) params.set('kind', filters.kind.join(','));
  return `/timeline${params.toString() ? `?${params.toString()}` : ''}`;
};

const highlights = (items: string[]) => items.slice(0, 5).map((item) => `- ${item}`);

const clampText = (value: string, max = 240) => value.trim().slice(0, max);

export const buildPersonalizedDigest = async ({
  jobType,
  profile,
  jobOutput,
  drive,
  driveFolderId,
  aliasMap,
}: {
  jobType: 'week_in_review' | 'alerts';
  profile: RecipientProfile;
  jobOutput: Record<string, unknown> & { perProfileReportDriveFileId?: string };
  drive: drive_v3.Drive;
  driveFolderId: string;
  accessToken?: string;
  now: Date;
  aliasMap?: EntityAliases;
  index?: ArtifactIndex;
}) => {
  const filters = normalizeProfileFilters(profile.filters, aliasMap);
  const index = (await loadArtifactIndex(drive, driveFolderId)).index;
  const dateFromISO = typeof jobOutput.dateFromISO === 'string'
    ? jobOutput.dateFromISO
    : (typeof jobOutput.lookbackStartISO === 'string' ? jobOutput.lookbackStartISO : undefined);
  const dateToISO = typeof jobOutput.dateToISO === 'string'
    ? jobOutput.dateToISO
    : (typeof jobOutput.nowISO === 'string' ? jobOutput.nowISO : undefined);

  const baseInput: StructuredQueryRequest = {
    dateFromISO,
    dateToISO,
    kind: filters.kind,
    tags: filters.tags,
    participants: filters.participants,
    openLoopStatus: 'open',
    limitArtifacts: 30,
    limitItemsPerArtifact: 10,
  };

  const entityInputs = filters.entities?.length ? filters.entities : [undefined];
  const merged = {
    risks: [] as string[],
    loops: [] as string[],
    decisions: [] as string[],
    actions: [] as string[],
    topRisks: [] as Array<{ text: string; severity?: string; owner?: string; dueDateISO?: string }>,
    topOpenLoops: [] as Array<{ text: string; owner?: string; dueDateISO?: string; status?: string }>,
    topDecisions: [] as Array<{ text: string; dateISO?: string; owner?: string }>,
    topActions: [] as Array<{ type: string; text: string; dueDateISO?: string }>,
    entities: new Map<string, number>(),
  };

  for (const entity of entityInputs) {
    const result = await runStructuredQuery({
      drive,
      index,
      input: {
        ...baseInput,
        ...(entity ? { entity } : {}),
        ...(filters.includeRisks ? { hasRisks: true } : {}),
        ...(filters.includeDecisions ? { hasDecisions: true } : {}),
        ...(filters.includeOpenLoops ? { hasOpenLoops: true } : {}),
      },
    });

    for (const row of result.results) {
      (row.entities ?? []).forEach((item) => {
        const key = normalizeEntityName(item.name);
        merged.entities.set(key, (merged.entities.get(key) ?? 0) + 1);
      });
      (row.matches.openLoops ?? []).forEach((item) => merged.loops.push(item.text));
      (row.matches.openLoops ?? []).forEach((item) => merged.topOpenLoops.push({
        text: clampText(item.text),
        owner: item.owner ?? undefined,
        dueDateISO: item.dueDateISO ?? undefined,
        status: item.status ?? undefined,
      }));
      (row.matches.decisions ?? []).forEach((item) => merged.decisions.push(item.text));
      (row.matches.decisions ?? []).forEach((item) => merged.topDecisions.push({ text: clampText(item.text), dateISO: item.dateISO ?? undefined, owner: item.owner ?? undefined }));
      (row.matches.risks ?? []).forEach((item) => {
        const sev = item.severity ?? 'low';
        if (!filters.riskSeverityMin || severityRanks[sev] >= severityRanks[filters.riskSeverityMin]) {
          merged.risks.push(`[${sev}] ${item.text}`);
          merged.topRisks.push({ text: clampText(item.text), severity: sev, owner: item.owner ?? undefined });
        }
      });
    }
  }

  const hasContent = merged.risks.length + merged.loops.length + merged.decisions.length + merged.actions.length > 0;

  const topEntities = Array.from(merged.entities.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} (${count})`);

  const scope = [
    filters.entities?.length ? `entities=${filters.entities.join(',')}` : undefined,
    filters.tags?.length ? `tags=${filters.tags.join(',')}` : undefined,
    filters.participants?.length ? `participants=${filters.participants.join(',')}` : undefined,
  ].filter(Boolean).join(' · ');

  const subjectBase = jobType === 'week_in_review' ? 'Week in Review' : 'Timeline Alerts';
  const subject = `${subjectBase} • ${profile.name ?? profile.id}`;

  const body = [
    `# ${subjectBase}`,
    '',
    `Window: ${dateFromISO ?? 'n/a'} to ${dateToISO ?? 'n/a'}`,
    `Your scope: ${scope || 'all indexed timeline items'}`,
    '',
    ...(topEntities.length ? ['Top entities', ...highlights(topEntities), ''] : []),
    ...(filters.includeRisks && merged.risks.length ? ['Risks', ...highlights(merged.risks), ''] : []),
    ...(filters.includeOpenLoops && merged.loops.length ? ['Open loops', ...highlights(merged.loops), ''] : []),
    ...(filters.includeDecisions && merged.decisions.length ? ['Decisions', ...highlights(merged.decisions), ''] : []),
    ...(filters.includeActions && merged.actions.length ? ['Actions', ...highlights(merged.actions), ''] : []),
    ...(hasContent ? [] : ['No updates in your scope this run.', '']),
    'Links',
    `- Timeline: ${timelineLink(filters)}`,
    ...(typeof jobOutput.perProfileReportDriveFileId === 'string'
      ? [`- Report link: https://drive.google.com/file/d/${jobOutput.perProfileReportDriveFileId}/view`]
      : (typeof jobOutput.reportDriveFileId === 'string' ? [`- Report: https://drive.google.com/file/d/${jobOutput.reportDriveFileId}/view`] : [])),
    ...(typeof jobOutput.noticeDriveFileId === 'string' ? [`- Notice: https://drive.google.com/file/d/${jobOutput.noticeDriveFileId}/view`] : []),
  ].join('\n');

  return {
    subject,
    body,
    empty: !hasContent,
    stats: {
      risks: merged.risks.length,
      openLoops: merged.loops.length,
      decisions: merged.decisions.length,
      actions: merged.actions.length,
      topEntities,
      riskSeverityAllowed: riskSeverities(filters.riskSeverityMin),
    },
    links: {
      drilldownUrl: timelineLink(filters),
      reportUrl: typeof jobOutput.perProfileReportDriveFileId === 'string'
        ? `https://drive.google.com/file/d/${jobOutput.perProfileReportDriveFileId}/view`
        : (typeof jobOutput.reportDriveFileId === 'string' ? `https://drive.google.com/file/d/${jobOutput.reportDriveFileId}/view` : undefined),
      synthesisUrl: typeof jobOutput.synthesisArtifactId === 'string' ? `/timeline?artifactId=${encodeURIComponent(jobOutput.synthesisArtifactId)}` : undefined,
    },
    top: {
      risks: merged.topRisks.slice(0, 20),
      openLoops: merged.topOpenLoops.slice(0, 20),
      decisions: merged.topDecisions.slice(0, 20),
      actions: merged.topActions.slice(0, 20),
    },
  };
};
