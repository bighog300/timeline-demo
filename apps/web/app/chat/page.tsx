import { isAdminSession } from '../lib/adminAuth';
import { getGoogleSession } from '../lib/googleAuth';

import ChatPageClient from './pageClient';

export default async function ChatPage() {
  const session = await getGoogleSession();
  return <ChatPageClient isAdmin={isAdminSession(session)} />;
}
