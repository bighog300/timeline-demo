import { isAdminSession } from '../../lib/adminAuth';
import { getGoogleSession } from '../../lib/googleAuth';

import AdminNav from '../AdminNav';
import SubscriptionsPageClient from './pageClient';

export default async function AdminSubscriptionsPage() {
  const session = await getGoogleSession();
  if (!isAdminSession(session)) {
    return (
      <div>
        <h1>Admin subscriptions</h1>
        <AdminNav />
        <p>Not authorized.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Admin subscriptions</h1>
      <AdminNav />
      <SubscriptionsPageClient />
    </div>
  );
}
