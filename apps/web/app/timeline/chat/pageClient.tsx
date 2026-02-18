'use client';

import { useState } from 'react';
import Link from 'next/link';

type Citation = {
  artifactId: string;
  excerpt: string;
  contentDateISO?: string;
  title?: string;
};

export default function TimelineChatPageClient() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError('Please enter at least 2 characters.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/timeline/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });

      const payload = (await response.json()) as {
        answer?: string;
        citations?: Citation[];
        error?: { message?: string };
      };

      if (!response.ok) {
        setError(payload.error?.message ?? 'Unable to chat with timeline artifacts.');
        return;
      }

      setAnswer(payload.answer ?? '');
      setCitations(Array.isArray(payload.citations) ? payload.citations : []);
    } catch {
      setError('Unable to chat with timeline artifacts.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem' }}>
      <h1>Timeline Chat</h1>
      <p>Ask grounded questions over Drive-backed timeline summary artifacts.</p>
      <textarea
        style={{ width: '100%', minHeight: 120, padding: 10 }}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Ask a question about your timeline..."
      />
      <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
        <button onClick={() => void send()} disabled={loading}>
          {loading ? 'Sending...' : 'Send'}
        </button>
        <Link href="/timeline">Back to Timeline</Link>
      </div>

      {error ? <p style={{ color: '#b00020' }}>{error}</p> : null}
      {answer ? (
        <article style={{ marginTop: 20 }}>
          <h2>Answer</h2>
          <p>{answer}</p>
          <h3>Citations</h3>
          <ul>
            {citations.map((citation) => (
              <li key={`${citation.artifactId}-${citation.excerpt}`} style={{ marginBottom: 12 }}>
                <strong>{citation.title ?? citation.artifactId}</strong>
                {citation.contentDateISO ? ` (${new Date(citation.contentDateISO).toLocaleDateString()})` : ''}
                <div>{citation.excerpt}</div>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
