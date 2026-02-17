import { isAdminSession } from '../lib/adminAuth';
import { enableDemoTabs } from '../lib/featureFlags';
import { getGoogleAccessToken, getGoogleSession } from '../lib/googleAuth';
import { createDriveClient } from '../lib/googleDrive';
import { loadChatContext, parseChatContextSelection } from '../lib/chatContextLoader';

import ChatPageClient from './pageClient';

export default async function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ mode?: string; n?: string; source?: string; id?: string }>;
}) {
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

  const params = (await searchParams) ?? {};
  const selection = parseChatContextSelection(params);

  const accessToken = await getGoogleAccessToken();
  if (!session?.driveFolderId || !accessToken) {
    return (
      <ChatPageClient
        isAdmin={isAdminSession(session)}
        contextArtifacts={[]}
        indexMissing
        contextKey="Recent 8 (All)"
        initialContext={selection}
      />
    );
  }

  const drive = createDriveClient(accessToken);
  const context = await loadChatContext({
    drive,
    driveFolderId: session.driveFolderId,
    selection,
  });

  return (
    <ChatPageClient
      isAdmin={isAdminSession(session)}
      contextArtifacts={context.items}
      indexMissing={context.indexMissing}
      contextKey={context.key}
      initialContext={selection}
      contextStats={context.stats}
      missingItems={context.missing}
    />
  );
}
