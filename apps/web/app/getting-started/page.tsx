import GettingStartedPageClient from './pageClient';
import { isAuthConfigured } from '../lib/googleAuth';

export default function GettingStartedPage() {
  return <GettingStartedPageClient isAuthConfigured={isAuthConfigured()} />;
}
