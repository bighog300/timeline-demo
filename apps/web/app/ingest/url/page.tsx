'use client';

import Link from 'next/link';
import { useState } from 'react';

import { parseApiError } from '../../lib/apiErrors';

type IngestResponse = {
  ok: true;
  url: string;
  source: {
    sourceId: string;
    driveTextFileId: string;
    driveMetaFileId: string;
    title?: string;
    fetchedAtISO: string;
    contentBytes: number;
  };
  artifactId?: string;
};

export default function UrlIngestPage() {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    const response = await fetch('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const parsed = await parseApiError(response);
      setError(parsed?.code ?? 'Failed to ingest URL');
      setSubmitting(false);
      return;
    }

    const payload = (await response.json()) as IngestResponse;
    setResult(payload);
    setSubmitting(false);
  };

  return (
    <main style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Ingest URL</h1>
      <p>Paste a public URL to extract readable text, store in Drive, and summarize into timeline artifacts.</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <input
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/article"
          style={{ padding: 10 }}
        />
        <button type="submit" disabled={submitting} style={{ width: 180, padding: 10 }}>
          {submitting ? 'Ingesting…' : 'Ingest URL'}
        </button>
      </form>

      {error ? <p style={{ color: '#c62828', marginTop: 16 }}>Error: {error}</p> : null}

      {result ? (
        <section style={{ marginTop: 20 }}>
          <p>
            Stored source <strong>{result.source.title ?? result.url}</strong> ({result.source.contentBytes} bytes).
          </p>
          <p>Text File ID: {result.source.driveTextFileId}</p>
          <p>Meta File ID: {result.source.driveMetaFileId}</p>
          {result.artifactId ? (
            <p>
              Summary created. <Link href="/timeline">Open Timeline</Link>
            </p>
          ) : (
            <p>No summary requested.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
