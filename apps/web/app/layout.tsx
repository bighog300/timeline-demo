import type { ReactNode } from 'react';
import Link from 'next/link';

import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
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
              </nav>
            </div>
          </header>
          <main className="app-main">{children}</main>
          <footer className="app-footer">Demo experience for the Timeline API.</footer>
        </div>
      </body>
    </html>
  );
}
