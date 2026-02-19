import ConnectPageClient from './pageClient';
import { getGoogleScopeStatus, getGoogleSession, isAuthConfigured } from '../lib/googleAuth';

type ConnectInitialState = {
  isConfigured: boolean;
  signedIn: boolean;
  email: string | null;
  scopes: string[];
  driveFolderId: string | null;
};

export default async function ConnectPage() {
  const configured = isAuthConfigured();
  const scopeStatus = getGoogleScopeStatus();
  const session = configured ? await getGoogleSession() : null;

  const initial: ConnectInitialState = {
    isConfigured: configured,
    signedIn: Boolean(session),
    email: session?.user?.email ?? null,
    scopes: session?.scopes ?? [],
    driveFolderId: session?.driveFolderId ?? null,
  };

  return <ConnectPageClient initial={initial} scopeStatus={scopeStatus} />;
}
