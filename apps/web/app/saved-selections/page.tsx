import { getGoogleSession, isAuthConfigured } from '../lib/googleAuth';
import SavedSelectionsClient from './SavedSelectionsClient';

export default async function SavedSelectionsPage() {
  const configured = isAuthConfigured();
  const session = configured ? await getGoogleSession() : null;

  if (!configured || !session) {
    return (
      <main style={{ padding: '1.5rem' }}>
        <h1>Saved Selections</h1>
        <p>Please connect</p>
      </main>
    );
  }

  return <SavedSelectionsClient />;
}
