import { isAdminSession } from '../../lib/adminAuth';
import { getGoogleSession } from '../../lib/googleAuth';

import SubscriptionsPageClient from './pageClient';

export default async function AdminSubscriptionsPage() {
  const session = await getGoogleSession();
  if (!isAdminSession(session)) {
    return (
      <div>
        <h1>Admin subscriptions</h1>
        <p>Not authorized.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Admin subscriptions</h1>
      <SubscriptionsPageClient />
    </div>
  );
}
