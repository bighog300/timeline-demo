import type { drive_v3 } from 'googleapis';

const slugify = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);

export const reportMarkerName = (runKey: string, profileId: string) => `report_saved_${slugify(`${runKey}__${profileId}`)}.json`;

export type ReportMarker = {
  runKey: string;
  profileId: string;
  reportDriveFileId: string;
  reportDriveFileName: string;
  savedAtISO: string;
};

const parseJson = (value: unknown): ReportMarker | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return parseJson(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.runKey === 'string'
    && typeof row.profileId === 'string'
    && typeof row.reportDriveFileId === 'string'
    && typeof row.reportDriveFileName === 'string'
    && typeof row.savedAtISO === 'string'
  ) {
    return row as ReportMarker;
  }
  return null;
};

export const readReportMarker = async ({
  drive,
  folderId,
  runKey,
  profileId,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  runKey: string;
  profileId: string;
}) => {
  const name = reportMarkerName(runKey, profileId);
  const listed = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name='${name}'`,
    pageSize: 1,
    fields: 'files(id)',
  });

  const markerId = listed.data.files?.[0]?.id;
  if (!markerId) return null;

  const marker = await drive.files.get({ fileId: markerId, alt: 'media' }, { responseType: 'json' });
  return parseJson(marker.data);
};

export const writeReportMarker = async ({
  drive,
  folderId,
  runKey,
  profileId,
  details,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  runKey: string;
  profileId: string;
  details: ReportMarker;
}) => {
  const name = reportMarkerName(runKey, profileId);
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
