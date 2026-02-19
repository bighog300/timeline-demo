import type { drive_v3 } from 'googleapis';

type MarkerType = 'slack' | 'webhook';

const slugify = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);

export const channelMarkerName = (type: MarkerType, runKey: string, recipientKey: string, targetKey: string) => (
  `${type}_sent_${slugify(`${runKey}__${recipientKey}__${targetKey}`)}.json`
);

export const existsMarker = async ({
  drive,
  folderId,
  type,
  runKey,
  recipientKey,
  targetKey,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  type: MarkerType;
  runKey: string;
  recipientKey: string;
  targetKey: string;
}) => {
  const name = channelMarkerName(type, runKey, recipientKey, targetKey);
  const listed = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name='${name}'`,
    pageSize: 1,
    fields: 'files(id)',
  });
  return Boolean(listed.data.files?.[0]?.id);
};

export const writeMarker = async ({
  drive,
  folderId,
  type,
  runKey,
  recipientKey,
  targetKey,
  details,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  type: MarkerType;
  runKey: string;
  recipientKey: string;
  targetKey: string;
  details: Record<string, unknown>;
}) => {
  await drive.files.create({
    requestBody: {
      name: channelMarkerName(type, runKey, recipientKey, targetKey),
      parents: [folderId],
      mimeType: 'application/json',
    },
    media: { mimeType: 'application/json', body: JSON.stringify(details, null, 2) },
    fields: 'id',
  });
};
