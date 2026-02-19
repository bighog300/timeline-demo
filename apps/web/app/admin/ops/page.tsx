import React from 'react';

import { isAdminSession } from '../../lib/adminAuth';
import { getGoogleSession } from '../../lib/googleAuth';

import AdminNav from '../AdminNav';
import OpsPageClient from './pageClient';

export default async function OpsPage() {
  const session = await getGoogleSession();

  if (!session) {
    return (
      <div>
        <h1>Ops Dashboard</h1>
        <AdminNav />
        <p>Sign in required.</p>
      </div>
    );
  }

  if (!isAdminSession(session)) {
    return (
      <div>
        <h1>Ops Dashboard</h1>
        <AdminNav />
        <p>Access denied (admin only).</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Ops Dashboard</h1>
      <AdminNav />
      <OpsPageClient />
    </div>
  );
}
