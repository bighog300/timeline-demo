import type { drive_v3 } from 'googleapis';

const slugify = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);

const driveFileLink = (fileId?: string | null) => (fileId ? `https://drive.google.com/file/d/${fileId}/view` : undefined);

const formatHighlights = (items: Array<string | undefined>) =>
  items
    .filter((item): item is string => Boolean(item && item.trim()))
    .slice(0, 7)
    .map((item) => `- ${item}`)
    .join('\n');

export const composeWeekInReviewEmail = ({
  job,
  runOutput,
}: {
  job: { id: string; notify?: { subjectPrefix?: string; includeLinks?: boolean } };
  runOutput: {
    dateFromISO?: string;
    dateToISO?: string;
    reportDriveFileId?: string | null;
    synthesisArtifactId?: string;
    totals?: { decisionsMatched?: number; openLoopsMatched?: number; risksMatched?: number; artifactsMatched?: number };
  };
  now: Date;
  driveFolderId: string;
}) => {
  const subjectBase = `Week in Review • ${runOutput.dateFromISO?.slice(0, 10) ?? ''} → ${runOutput.dateToISO?.slice(0, 10) ?? ''}`;
  const subject = `${job.notify?.subjectPrefix?.trim() ?? ''}${job.notify?.subjectPrefix ? ' ' : ''}${subjectBase}`;
  const reportLink = driveFileLink(runOutput.reportDriveFileId);
  const includeLinks = job.notify?.includeLinks !== false;

  const body = [
    '# Timeline Week in Review',
    '',
    `Window: ${runOutput.dateFromISO ?? 'n/a'} to ${runOutput.dateToISO ?? 'n/a'}`,
    '',
    'Highlights',
    formatHighlights([
      `Artifacts reviewed: ${runOutput.totals?.artifactsMatched ?? 0}`,
      `Decisions: ${runOutput.totals?.decisionsMatched ?? 0}`,
      `Open loops: ${runOutput.totals?.openLoopsMatched ?? 0}`,
      `High risks: ${runOutput.totals?.risksMatched ?? 0}`,
    ]),
    '',
    ...(includeLinks
      ? [
          'Links',
          '- Dashboard: /timeline/dashboard',
          ...(reportLink ? [`- Report: ${reportLink}`] : []),
          ...(runOutput.synthesisArtifactId
            ? [`- Synthesis: /timeline?artifactId=${encodeURIComponent(runOutput.synthesisArtifactId)}`]
            : []),
          '',
        ]
      : []),
    `Job ID: ${job.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, body };
};

export const composeAlertsEmail = ({
  job,
  runOutput,
}: {
  job: { id: string; notify?: { subjectPrefix?: string; includeLinks?: boolean } };
  runOutput: {
    counts?: { new_high_risks?: number; new_open_loops_due_7d?: number; new_decisions?: number };
    noticeDriveFileId?: string | null;
    lookbackStartISO?: string;
    nowISO?: string;
  };
  now: Date;
  driveFolderId: string;
}) => {
  const subjectBase = `Timeline Alerts • ${runOutput.nowISO?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}`;
  const subject = `${job.notify?.subjectPrefix?.trim() ?? ''}${job.notify?.subjectPrefix ? ' ' : ''}${subjectBase}`;
  const includeLinks = job.notify?.includeLinks !== false;
  const noticeLink = driveFileLink(runOutput.noticeDriveFileId);
  const body = [
    '# Timeline Alerts',
    '',
    `Window: ${runOutput.lookbackStartISO ?? 'n/a'} to ${runOutput.nowISO ?? 'n/a'}`,
    '',
    'Top items',
    formatHighlights([
      `New high risks: ${runOutput.counts?.new_high_risks ?? 0}`,
      `Open loops due soon: ${runOutput.counts?.new_open_loops_due_7d ?? 0}`,
      `New decisions: ${runOutput.counts?.new_decisions ?? 0}`,
    ]),
    '',
    ...(includeLinks
      ? ['Links', '- Dashboard: /timeline/dashboard', ...(noticeLink ? [`- Notice: ${noticeLink}`] : []), '']
      : []),
    `Job ID: ${job.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, body };
};

export const emailMarkerName = (runKey: string, recipientKey = 'broadcast') => `email_sent_${slugify(`${runKey}__${recipientKey}`)}.json`;

export const shouldSendEmailMarkerExists = async ({
  drive,
  folderId,
  runKey,
  recipientKey = 'broadcast',
}: {
  drive: drive_v3.Drive;
  folderId: string;
  runKey: string;
  recipientKey?: string;
}) => {
  const scopedName = emailMarkerName(runKey, recipientKey);
  const legacyName = `email_sent_${slugify(runKey)}.json`;
  const q = recipientKey === 'broadcast'
    ? `'${folderId}' in parents and trashed=false and (name='${scopedName}' or name='${legacyName}')`
    : `'${folderId}' in parents and trashed=false and name='${scopedName}'`;
  const listed = await drive.files.list({
    q,
    pageSize: 1,
    fields: 'files(id)',
  });

  return Boolean(listed.data.files?.[0]?.id);
};

export const writeEmailSentMarker = async ({
  drive,
  folderId,
  runKey,
  recipientKey = 'broadcast',
  details,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  runKey: string;
  recipientKey?: string;
  details: Record<string, unknown>;
}) => {
  const name = emailMarkerName(runKey, recipientKey);
  await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/json',
    },
    media: { mimeType: 'application/json', body: JSON.stringify(details, null, 2) },
    fields: 'id',
  });
};
