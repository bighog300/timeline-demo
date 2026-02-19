import type { drive_v3 } from 'googleapis';

import { DEFAULT_GOOGLE_TIMEOUT_MS, withRetry, withTimeout } from '../googleRequest';

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);

export const saveReportToDrive = async ({
  drive,
  folderId,
  title,
  markdown,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  title: string;
  markdown: string;
}) => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = `report_${datePart}_${slugify(title)}.md`;
  const created = await withRetry((signal) =>
    withTimeout(
      (timeoutSignal) =>
        drive.files.create(
          {
            requestBody: { name: fileName, parents: [folderId], mimeType: 'text/markdown' },
            media: { mimeType: 'text/markdown', body: markdown },
            fields: 'id,name',
          },
          { signal: timeoutSignal },
        ),
      DEFAULT_GOOGLE_TIMEOUT_MS,
      'upstream_timeout',
      signal,
    ),
  );

  return { driveFileId: created.data.id, driveFileName: created.data.name ?? fileName };
};
