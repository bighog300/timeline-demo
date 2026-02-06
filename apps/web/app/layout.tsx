import type { ReactNode } from 'react';
import Link from 'next/link';

import './globals.css';
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
                <nav className="app-nav" aria-label="Primary">
                  <Link href="/">Home</Link>
                  <Link href="/events">Events</Link>
                  <Link href="/calendar">Calendar</Link>
                  <Link href="/chat">Chat</Link>
                  <Link href="/connect">Connect</Link>
                  <Link href="/select/gmail">Select Gmail</Link>
                  <Link href="/select/drive">Select Drive</Link>
                  <Link href="/timeline">Timeline</Link>
                </nav>
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
