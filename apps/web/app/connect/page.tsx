import ConnectPageClient from './pageClient';
import { getGoogleScopeStatus, isAuthConfigured } from '../lib/googleAuth';

export default function ConnectPage() {
  const scopeStatus = getGoogleScopeStatus();
  return <ConnectPageClient isConfigured={isAuthConfigured()} scopeStatus={scopeStatus} />;
}
