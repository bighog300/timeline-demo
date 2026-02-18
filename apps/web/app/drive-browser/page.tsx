import { getGoogleSession, isAuthConfigured } from '../lib/googleAuth';
import DriveBrowserClient from './DriveBrowserClient';

export default async function DriveBrowserPage() {
  const configured = isAuthConfigured();
  const session = configured ? await getGoogleSession() : null;

  if (!configured || !session || !session.driveFolderId) {
    return (
      <main style={{ padding: '1.5rem' }}>
        <h1>Browse Drive</h1>
        <p>Please connect</p>
      </main>
    );
  }

  return <DriveBrowserClient />;
}
