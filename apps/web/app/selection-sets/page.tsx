import { isAuthConfigured } from '../lib/googleAuth';
import SelectionSetsPageClient from './pageClient';

export default function SelectionSetsPage() {
  return <SelectionSetsPageClient isConfigured={isAuthConfigured()} />;
}
