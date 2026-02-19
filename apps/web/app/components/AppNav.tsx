'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { enableDemoTabs } from '../lib/featureFlags';

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
    href: '/getting-started',
    label: 'Getting Started',
    match: (pathname) => pathname.startsWith('/getting-started'),
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
    href: '/drive-browser',
    label: 'Browse Drive',
    match: (pathname) => pathname.startsWith('/drive-browser'),
  },
  {
    href: '/saved-searches',
    label: 'Saved Searches',
    match: (pathname) => pathname.startsWith('/saved-searches'),
  },
  {
    href: '/saved-selections',
    label: 'Saved Selections',
    match: (pathname) => pathname.startsWith('/saved-selections'),
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
  const visibleItems = enableDemoTabs()
    ? navItems
    : navItems.filter((item) => item.href !== '/calendar' && item.href !== '/chat');

  return (
    <nav className="app-nav" aria-label="Primary">
      {visibleItems.map((item) => {
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
