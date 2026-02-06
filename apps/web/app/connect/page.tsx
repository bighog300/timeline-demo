import ConnectPageClient from './pageClient';
import { isAuthConfigured } from '../lib/googleAuth';

export default function ConnectPage() {
  return <ConnectPageClient isConfigured={isAuthConfigured()} />;
}
