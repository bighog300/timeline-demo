import type { StructuredQueryRequest, StructuredQueryResponse } from '@timeline/shared';
import type { drive_v3 } from 'googleapis';

import { renderMarkdownReport } from '../reports/renderMarkdownReport';
import { saveReportToDrive } from '../reports/saveReportToDrive';
import { loadArtifactIndex } from '../timeline/artifactIndex';
import { runStructuredQuery } from '../timeline/structuredQuery';
import { readReportMarker, writeReportMarker } from './reportMarkers';

type JobType = 'week_in_review' | 'alerts';
type Profile = {
  id: string;
  name?: string;
  filters: {
    entities?: string[];
    tags?: string[];
    participants?: string[];
    kind?: Array<'summary' | 'synthesis'>;
    riskSeverityMin?: 'low' | 'medium' | 'high';
    includeOpenLoops?: boolean;
    includeRisks?: boolean;
    includeDecisions?: boolean;
  };
};

const counters = new Map<string, number>();

const safeSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const safePart = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);

export const resetPerProfileReportCounter = (runKey: string) => {
  counters.delete(runKey);
};

const applyTitleTemplate = ({
  template,
  fallback,
  values,
}: {
  template?: string;
  fallback: string;
  values: Record<string, string>;
}) => {
  if (!template?.trim()) return fallback;
  return template.replace(/\{(jobName|profileName|profileId|dateFrom|dateTo)\}/g, (_token, key: string) => values[key] ?? '');
};

export const maybeGeneratePerProfileReport = async ({
  enabled,
  reportTitleTemplate,
  maxPerRouteReportsPerRun,
  jobType,
  jobId,
  runKey,
  profile,
  dateWindow,
  drive,
  driveFolderId,
}: {
  enabled?: boolean;
  reportTitleTemplate?: string;
  maxPerRouteReportsPerRun?: number;
  jobType: JobType;
  jobId: string;
  runKey: string;
  profile: Profile;
  dateWindow: { dateFromISO?: string; dateToISO?: string };
  drive: drive_v3.Drive;
  driveFolderId: string;
}) => {
  if (!enabled) return { skipped: true as const, reason: 'disabled' as const };

  const marker = await readReportMarker({ drive, folderId: driveFolderId, runKey, profileId: profile.id });
  if (marker) {
    return {
      report: { driveFileId: marker.reportDriveFileId, driveFileName: marker.reportDriveFileName },
      reused: true as const,
    };
  }

  const maxPerRun = Math.min(maxPerRouteReportsPerRun ?? 5, 25);
  const used = counters.get(runKey) ?? 0;
  if (used >= maxPerRun) return { skipped: true as const, reason: 'cap_reached' as const };

  const dateFrom = dateWindow.dateFromISO?.slice(0, 10) ?? 'n/a';
  const dateTo = dateWindow.dateToISO?.slice(0, 10) ?? 'n/a';
  const label = profile.name?.trim() || profile.id;
  const fallbackTitle = `${jobType === 'week_in_review' ? 'Week in Review' : 'Alerts'} — ${label} — ${dateFrom} to ${dateTo}`;
  const title = applyTitleTemplate({
    template: reportTitleTemplate,
    fallback: fallbackTitle,
    values: {
      jobName: jobType === 'week_in_review' ? 'Week in Review' : 'Alerts',
      profileName: profile.name ?? profile.id,
      profileId: profile.id,
      dateFrom,
      dateTo,
    },
  });

  const query: StructuredQueryRequest = {
    dateFromISO: dateWindow.dateFromISO,
    dateToISO: dateWindow.dateToISO,
    entity: profile.filters.entities?.[0],
    tags: profile.filters.tags,
    participants: profile.filters.participants,
    kind: profile.filters.kind,
    limitArtifacts: 30,
    limitItemsPerArtifact: 10,
  };

  try {
    const loaded = await loadArtifactIndex(drive, driveFolderId);
    const result: StructuredQueryResponse = await runStructuredQuery({ drive, index: loaded.index, input: query });

    const scope = [
      profile.filters.entities?.length ? `entities=${profile.filters.entities.join(',')}` : undefined,
      profile.filters.tags?.length ? `tags=${profile.filters.tags.join(',')}` : undefined,
      profile.filters.participants?.length ? `participants=${profile.filters.participants.join(',')}` : undefined,
      profile.filters.riskSeverityMin ? `riskSeverityMin=${profile.filters.riskSeverityMin}` : undefined,
    ].filter(Boolean).join(' · ');

    const markdown = `${renderMarkdownReport({
      title,
      generatedAtISO: new Date().toISOString(),
      query: result.query,
      results: result.results,
      includeCitations: true,
    })}\n## Scope\n\n${scope || 'all indexed timeline items'}\n`;

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `report_${datePart}_${safePart(jobId)}_${safePart(profile.id)}_${safeSlug(title).slice(0, 50)}.md`.slice(0, 180);

    const saved = await saveReportToDrive({
      drive,
      folderId: driveFolderId,
      title,
      markdown,
      fileName,
    });

    counters.set(runKey, used + 1);

    try {
      await writeReportMarker({
        drive,
        folderId: driveFolderId,
        runKey,
        profileId: profile.id,
        details: {
          runKey,
          profileId: profile.id,
          reportDriveFileId: saved.driveFileId ?? '',
          reportDriveFileName: saved.driveFileName ?? fileName,
          savedAtISO: new Date().toISOString(),
        },
      });
    } catch (error) {
      return {
        report: { driveFileId: saved.driveFileId ?? '', driveFileName: saved.driveFileName ?? fileName },
        warning: error instanceof Error ? error.message : 'marker_write_failed',
      };
    }

    return { report: { driveFileId: saved.driveFileId ?? '', driveFileName: saved.driveFileName ?? fileName } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'report_generation_failed' };
  }
};
