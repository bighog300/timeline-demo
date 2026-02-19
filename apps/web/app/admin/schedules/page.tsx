import { isAdminSession } from '../../lib/adminAuth';
import { getGoogleSession } from '../../lib/googleAuth';

import SchedulesEditor from './SchedulesEditor';

export default async function AdminSchedulesPage() {
  const session = await getGoogleSession();
  if (!isAdminSession(session)) {
    return (
      <div>
        <h1>Admin schedules</h1>
        <p>Access denied.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Admin schedules</h1>
      <SchedulesEditor />
    </div>
  );
}
