import { DriveSummaryJsonSchema } from '@timeline/shared';

import { isAdminSession } from '../lib/adminAuth';
import { readAdminSettingsFromDrive } from '../lib/adminSettingsDrive';
import { enableDemoTabs } from '../lib/featureFlags';
import { getGoogleAccessToken, getGoogleSession } from '../lib/googleAuth';
import { createDriveClient } from '../lib/googleDrive';
import { findIndexFile, readIndexFile } from '../lib/indexDrive';

import ChatPageClient from './pageClient';

type ChatContextArtifact = {
  artifactId: string;
  title: string;
  driveWebViewLink?: string;
};

const SUMMARY_SUFFIX = ' - Summary.json';

const loadContextArtifacts = async () => {
  const session = await getGoogleSession();
  const accessToken = await getGoogleAccessToken();

  if (!session?.driveFolderId || !accessToken) {
    return { artifacts: [] as ChatContextArtifact[], indexMissing: true };
  }

  const drive = createDriveClient(accessToken);
  const settingsResult = await readAdminSettingsFromDrive(drive, session.driveFolderId);
  const maxItems = settingsResult.settings?.maxContextItems ?? 8;

  const readArtifact = async (fileId: string): Promise<ChatContextArtifact | null> => {
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'json' });
    const parsed = DriveSummaryJsonSchema.safeParse(response.data);
    if (!parsed.success) {
      return null;
    }

    return {
      artifactId: parsed.data.driveFileId || parsed.data.artifactId,
      title: parsed.data.title,
      driveWebViewLink: parsed.data.driveWebViewLink,
    };
  };

  const indexFile = await findIndexFile(drive, session.driveFolderId);
  if (indexFile?.id) {
    const index = await readIndexFile(drive, indexFile.id, session.driveFolderId);
    if (index) {
      const artifacts = (
        await Promise.all(
          [...index.summaries]
            .sort(
              (a, b) =>
                new Date(b.updatedAtISO ?? b.createdAtISO ?? 0).getTime() -
                new Date(a.updatedAtISO ?? a.createdAtISO ?? 0).getTime(),
            )
            .slice(0, maxItems)
            .map((summary) => readArtifact(summary.driveFileId)),
        )
      ).filter((artifact): artifact is ChatContextArtifact => artifact !== null);

      return { artifacts, indexMissing: false };
    }
  }

  const listResponse = await drive.files.list({
    q: `'${session.driveFolderId}' in parents and trashed=false and name contains '${SUMMARY_SUFFIX}'`,
    orderBy: 'modifiedTime desc',
    pageSize: maxItems,
    fields: 'files(id)',
  });

  const artifacts = (
    await Promise.all((listResponse.data.files ?? []).map((file) => (file.id ? readArtifact(file.id) : null)))
  ).filter((artifact): artifact is ChatContextArtifact => artifact !== null);

  return { artifacts, indexMissing: true };
};

export default async function ChatPage() {
  const session = await getGoogleSession();
  const demoTabsEnabled = enableDemoTabs();

  if (!demoTabsEnabled) {
    return (
      <section>
        <h1>Feature disabled</h1>
        <p>This feature is disabled. Set NEXT_PUBLIC_ENABLE_DEMO_TABS=true to enable it.</p>
      </section>
    );
  }

  const { artifacts, indexMissing } = await loadContextArtifacts();

  return (
    <ChatPageClient
      isAdmin={isAdminSession(session)}
      contextArtifacts={artifacts}
      indexMissing={indexMissing}
    />
  );
}
