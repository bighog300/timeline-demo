import { isAdminSession } from '../../lib/adminAuth';
import { getGoogleSession } from '../../lib/googleAuth';

import AdminSettingsForm from './AdminSettingsForm';
import styles from './page.module.css';

export default async function AdminSettingsPage() {
  const session = await getGoogleSession();

  if (!isAdminSession(session)) {
    return (
      <div className={styles.container}>
        <h1>Admin settings</h1>
        <p className={styles.notice}>Access denied.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1>Admin settings</h1>
      <p className={styles.caption}>
        API keys are configured via environment variables on the server; they are never stored in
        Drive.
      </p>
      <AdminSettingsForm />
    </div>
  );
}
