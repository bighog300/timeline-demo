'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './AdminNav.module.css';

const links = [
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
  { href: '/admin/schedules', label: 'Schedules' },
  { href: '/admin/ops', label: 'Ops' },
] as const;

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className={styles.nav}>
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`${styles.link} ${isActive ? styles.active : ''}`.trim()}
            aria-current={isActive ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
