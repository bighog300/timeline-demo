import type { ReactNode } from 'react';
import Link from 'next/link';

import './globals.css';
import AppNav from './components/AppNav';
import AppSessionProvider from './components/SessionProvider';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppSessionProvider>
          <div className="app-shell">
            <header className="app-header">
              <div className="app-header__content">
                <Link className="app-brand" href="/">
                  Timeline Demo
                </Link>
                <AppNav />
              </div>
            </header>
            <main className="app-main">{children}</main>
            <footer className="app-footer">Demo experience for the Timeline API.</footer>
          </div>
        </AppSessionProvider>
      </body>
    </html>
  );
}
