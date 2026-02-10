'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = {
  href: string;
  label: string;
  match?: (pathname: string) => boolean;
};

const navItems: NavItem[] = [
  {
    href: '/connect',
    label: 'Connect',
    match: (pathname) => pathname.startsWith('/connect'),
  },
  {
    href: '/select/gmail',
    label: 'Select Gmail',
    match: (pathname) => pathname.startsWith('/select/gmail'),
  },
  {
    href: '/select/drive',
    label: 'Select Drive',
    match: (pathname) => pathname.startsWith('/select/drive'),
  },
  {
    href: '/selection-sets',
    label: 'Selection Sets',
    match: (pathname) => pathname.startsWith('/selection-sets'),
  },
  {
    href: '/timeline',
    label: 'Timeline',
    match: (pathname) => pathname.startsWith('/timeline'),
  },
  {
    href: '/calendar',
    label: 'Calendar',
    match: (pathname) => pathname.startsWith('/calendar'),
  },
  {
    href: '/chat',
    label: 'Chat',
    match: (pathname) => pathname.startsWith('/chat'),
  },
];

export default function AppNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav className="app-nav" aria-label="Primary">
      {navItems.map((item) => {
        const isActive = item.match ? item.match(pathname) : pathname === item.href;
        return (
          <Link key={item.href} href={item.href} data-active={isActive}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
