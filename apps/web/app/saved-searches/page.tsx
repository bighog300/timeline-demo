import { isAuthConfigured } from '../lib/googleAuth';
import SavedSearchesPageClient from './pageClient';

export default function SavedSearchesPage() {
  return <SavedSearchesPageClient isConfigured={isAuthConfigured()} />;
}
