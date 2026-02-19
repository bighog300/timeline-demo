import { isAdminSession } from '../../lib/adminAuth';
import { getGoogleSession } from '../../lib/googleAuth';

import AdminNav from '../AdminNav';
import SchedulesEditor from './SchedulesEditor';

export default async function AdminSchedulesPage() {
  const session = await getGoogleSession();
  if (!isAdminSession(session)) {
    return (
      <div>
        <h1>Admin schedules</h1>
        <AdminNav />
        <p>Access denied.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Admin schedules</h1>
      <AdminNav />
      <SchedulesEditor />
    </div>
  );
}
