import Link from 'next/link';

import { DriveSummaryJsonSchema } from '@timeline/shared';

import Card from '../components/ui/Card';
import { enableDemoTabs } from '../lib/featureFlags';
import { getGoogleAccessToken, getGoogleSession } from '../lib/googleAuth';
import { createDriveClient } from '../lib/googleDrive';
import { findIndexFile, readIndexFile } from '../lib/indexDrive';
import type { SummaryArtifact } from '../lib/types';
import { groupArtifactsByDay } from '../lib/groupArtifactsByDay';
import styles from './page.module.css';

const SUMMARY_SUFFIX = ' - Summary.json';
const FALLBACK_READ_CAP = 200;

type CalendarArtifactView = {
  id: string;
  title: string;
  source: SummaryArtifact['source'];
  createdAtISO: string;
  dayKey: string;
  driveWebViewLink?: string;
  preview?: string;
};

const toDayKey = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    return 'unknown';
  }
  return date.toISOString().slice(0, 10);
};

const excerpt = (summary: string) => {
  const trimmed = summary.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
};

const loadArtifacts = async (): Promise<{
  artifacts: SummaryArtifact[];
  indexMissing: boolean;
}> => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();
  if (!session?.driveFolderId || !accessToken) {
    return { artifacts: [], indexMissing: true };
  }

  const drive = createDriveClient(accessToken);
  const indexFile = await findIndexFile(drive, session.driveFolderId);

  const readArtifact = async (fileId: string): Promise<SummaryArtifact | null> => {
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json' });
    const parsed = DriveSummaryJsonSchema.safeParse(response.data);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  };

  if (indexFile?.id) {
    const index = await readIndexFile(drive, indexFile.id, session.driveFolderId);
    if (index) {
      const sorted = [...index.summaries]
        .sort(
          (a, b) =>
            new Date(b.updatedAtISO ?? b.createdAtISO ?? 0).getTime() -
            new Date(a.updatedAtISO ?? a.createdAtISO ?? 0).getTime(),
        )
        .slice(0, FALLBACK_READ_CAP);

      const artifacts = (
        await Promise.all(sorted.map((summary) => readArtifact(summary.driveFileId)))
      ).filter((artifact): artifact is SummaryArtifact => artifact !== null);

      return { artifacts, indexMissing: false };
    }
  }

  const files = await drive.files.list({
    q: `'${session.driveFolderId}' in parents and trashed=false and name contains '${SUMMARY_SUFFIX}'`,
    orderBy: 'modifiedTime desc',
    pageSize: FALLBACK_READ_CAP,
    fields: 'files(id)',
  });

  const artifacts = (
    await Promise.all((files.data.files ?? []).map((file) => (file.id ? readArtifact(file.id) : null)))
  ).filter((artifact): artifact is SummaryArtifact => artifact !== null);

  return { artifacts, indexMissing: true };
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: Promise<{ day?: string }>;
}) {
  if (!enableDemoTabs()) {
    return (
      <Card>
        <h1>Feature disabled</h1>
        <p>This feature is disabled. Set NEXT_PUBLIC_ENABLE_DEMO_TABS=true to enable it.</p>
      </Card>
    );
  }

  const params = (await searchParams) ?? {};
  const { artifacts, indexMissing } = await loadArtifacts();
  const grouped = groupArtifactsByDay(artifacts);
  const days = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  const selectedDay = params.day && grouped[params.day] ? params.day : days[0];

  const dayViews = days.reduce<Record<string, CalendarArtifactView[]>>((acc, day) => {
    acc[day] = grouped[day]
      .map((artifact) => ({
        id: artifact.driveFileId || artifact.artifactId,
        title: artifact.title,
        source: artifact.source,
        createdAtISO: artifact.createdAtISO,
        dayKey: toDayKey(artifact.sourceMetadata?.dateISO ?? artifact.createdAtISO),
        driveWebViewLink: artifact.driveWebViewLink,
        preview: excerpt(artifact.summary),
      }))
      .sort((a, b) => new Date(b.createdAtISO).getTime() - new Date(a.createdAtISO).getTime());
    return acc;
  }, {});

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Calendar</p>
          <h1>Saved summary calendar</h1>
          <p>Month/day projection of your Drive-backed summary artifacts.</p>
        </div>
      </div>

      {indexMissing ? (
        <Card>
          <p>Index missing: showing up to {FALLBACK_READ_CAP} artifacts. Rebuild index for faster load.</p>
          <form action="/api/timeline/index/rebuild" method="post">
            <button type="submit">Rebuild index</button>
          </form>
        </Card>
      ) : null}

      <Card>
        <h2>Days</h2>
        <div className={styles.tagList}>
          {days.map((day) => (
            <Link key={day} href={`/calendar?day=${encodeURIComponent(day)}`}>
              {day} ({dayViews[day].length})
            </Link>
          ))}
        </div>
      </Card>

      {selectedDay ? (
        <Card>
          <h2>Artifacts for {selectedDay}</h2>
          <ul>
            {dayViews[selectedDay].map((artifact) => (
              <li key={artifact.id}>
                <strong>{artifact.title}</strong> · {artifact.source} · {artifact.createdAtISO}
                {artifact.driveWebViewLink ? (
                  <>
                    {' '}
                    ·{' '}
                    <a href={artifact.driveWebViewLink} target="_blank" rel="noreferrer">
                      Open in Drive
                    </a>
                  </>
                ) : null}
                {artifact.preview ? <p>{artifact.preview}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <p>No saved summary artifacts found yet.</p>
        </Card>
      )}
    </section>
  );
}
