import type { drive_v3 } from 'googleapis';

import { renderMarkdownReport } from '../reports/renderMarkdownReport';
import { saveReportToDrive } from '../reports/saveReportToDrive';
import { loadArtifactIndex } from '../timeline/artifactIndex';
import { runStructuredQuery } from '../timeline/structuredQuery';

const ymd = (now: Date) => now.toISOString().slice(0, 10).replace(/-/g, '');

export const saveNoticeToDrive = async ({
  drive,
  folderId,
  jobId,
  now,
  markdown,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  jobId: string;
  now: Date;
  markdown: string;
}) => {
  const name = `notice_${ymd(now)}_${jobId}.md`;
  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'text/markdown',
    },
    media: { mimeType: 'text/markdown', body: markdown },
    fields: 'id,name',
  });

  return { noticeDriveFileId: created.data.id, noticeDriveFileName: created.data.name ?? name };
};

export const appendJobRunLog = async ({
  drive,
  folderId,
  record,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  record: Record<string, unknown>;
}) => {
  const name = 'job_runs.jsonl';
  const listed = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name='${name}'`,
    pageSize: 1,
    fields: 'files(id)',
  });

  const fileId = listed.data.files?.[0]?.id;
  const line = `${JSON.stringify(record)}\n`;

  if (!fileId) {
    await drive.files.create({
      requestBody: { name, parents: [folderId], mimeType: 'application/x-ndjson' },
      media: { mimeType: 'application/x-ndjson', body: line },
      fields: 'id',
    });
    return;
  }

  const existing = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const next = `${typeof existing.data === 'string' ? existing.data : ''}${line}`;
  await drive.files.update({
    fileId,
    media: { mimeType: 'application/x-ndjson', body: next },
    fields: 'id',
  });
};

export const runWeekInReviewJob = async ({
  drive,
  params,
  now,
  driveFolderId,
}: {
  drive: drive_v3.Drive;
  params?: { includeEvidence?: boolean; exportReport?: boolean; saveToTimeline?: boolean };
  now: Date;
  driveFolderId: string;
}) => {
  const dateToISO = now.toISOString();
  const dateFromISO = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const loaded = await loadArtifactIndex(drive, driveFolderId);
  const queryResult = await runStructuredQuery({
    drive,
    index: loaded.index,
    input: {
      dateFromISO,
      dateToISO,
      kind: ['summary', 'synthesis'],
      limitArtifacts: 30,
      limitItemsPerArtifact: 10,
    },
  });

  const title = `Week in Review — ${dateFromISO.slice(0, 10)} to ${dateToISO.slice(0, 10)}`;
  const markdown = renderMarkdownReport({
    title,
    generatedAtISO: now.toISOString(),
    query: queryResult.query,
    results: queryResult.results,
    includeCitations: true,
  });

  const report = params?.exportReport === false
    ? undefined
    : await saveReportToDrive({ drive, folderId: driveFolderId, title, markdown });

  return {
    synthesisArtifactId: undefined,
    reportDriveFileId: report?.driveFileId,
    reportDriveFileName: report?.driveFileName,
    dateFromISO,
    dateToISO,
  };
};

export const runAlertsJob = async ({
  drive,
  params,
  now,
  driveFolderId,
  timezone,
}: {
  drive: drive_v3.Drive;
  params: {
    alertTypes: Array<'new_high_risks' | 'new_open_loops_due_7d' | 'new_decisions'>;
    lookbackDays: number;
    riskSeverity?: 'high';
    dueInDays?: number;
  };
  now: Date;
  driveFolderId: string;
  timezone: string;
}) => {
  const loaded = await loadArtifactIndex(drive, driveFolderId);
  const fromISO = new Date(now.getTime() - params.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const dueToISO = new Date(now.getTime() + (params.dueInDays ?? 7) * 24 * 60 * 60 * 1000).toISOString();

  const counts = { new_high_risks: 0, new_open_loops_due_7d: 0, new_decisions: 0 };

  if (params.alertTypes.includes('new_high_risks')) {
    const result = await runStructuredQuery({
      drive,
      index: loaded.index,
      input: { dateFromISO: fromISO, hasRisks: true, riskSeverity: 'high', limitArtifacts: 20, limitItemsPerArtifact: 5 },
    });
    counts.new_high_risks = result.totals.risksMatched;
  }

  if (params.alertTypes.includes('new_open_loops_due_7d')) {
    const result = await runStructuredQuery({
      drive,
      index: loaded.index,
      input: {
        openLoopStatus: 'open',
        openLoopDueToISO: dueToISO,
        dateFromISO: fromISO,
        limitArtifacts: 20,
        limitItemsPerArtifact: 5,
      },
    });
    counts.new_open_loops_due_7d = result.totals.openLoopsMatched;
  }

  if (params.alertTypes.includes('new_decisions')) {
    const result = await runStructuredQuery({
      drive,
      index: loaded.index,
      input: {
        hasDecisions: true,
        decisionFromISO: fromISO,
        limitArtifacts: 20,
        limitItemsPerArtifact: 5,
      },
    });
    counts.new_decisions = result.totals.decisionsMatched;
  }

  const markdown = `# Alerts\n\nGenerated: ${now.toISOString()}\nTimezone: ${timezone}\n\n- New high risks: ${counts.new_high_risks}\n- Open loops due soon: ${counts.new_open_loops_due_7d}\n- New decisions: ${counts.new_decisions}\n`;
  const notice = await saveNoticeToDrive({ drive, folderId: driveFolderId, jobId: 'alerts', now, markdown });

  return { ...notice, counts };
};
