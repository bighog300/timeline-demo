import GmailSelectClient from './pageClient';
import { isAuthConfigured } from '../../lib/googleAuth';

export default function GmailSelectPage() {
  return <GmailSelectClient isConfigured={isAuthConfigured()} />;
}
