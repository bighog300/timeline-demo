import DriveSelectClient from './pageClient';
import { isAuthConfigured } from '../../lib/googleAuth';

export default function DriveSelectPage() {
  return <DriveSelectClient isConfigured={isAuthConfigured()} />;
}
