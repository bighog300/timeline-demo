import type { Session } from 'next-auth';

const splitAdminEmails = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const getAdminEmailList = () => splitAdminEmails(process.env.ADMIN_EMAILS);

export const isAdminSession = (session: Session | null) => {
  if (!session?.user?.email) {
    return false;
  }

  const email = session.user.email.trim().toLowerCase();
  if (!email) {
    return false;
  }

  const adminEmails = getAdminEmailList();
  return adminEmails.includes(email);
};
