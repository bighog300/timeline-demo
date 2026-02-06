'use client';

import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';

type SessionProviderProps = {
  children: ReactNode;
};

export default function AppSessionProvider({ children }: SessionProviderProps) {
  return <SessionProvider>{children}</SessionProvider>;
}
