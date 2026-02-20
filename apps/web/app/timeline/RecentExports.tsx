'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import styles from './timeline.module.css';

export type RecentExportItem = {
  exportId: string;
  createdAtISO: string;
  format: 'pdf' | 'drive_doc';
  artifactIds: string[];
  artifactCount: number;
  source: {
    viewMode: 'summaries' | 'timeline';
    selectionSetId?: string;
    query?: string;
    from?: string;
  };
  result: {
    driveDoc?: { docId: string; webViewLink: string };
    pdf?: { filename: string };
  };
};

type Props = {
  viewMode: 'summaries' | 'timeline';
  selectionSetId?: string | null;
  from?: string;
  query?: string;
};

const relativeTime = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return 'Unknown time';
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
};

const startDownload = async (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

export default function RecentExports({ viewMode, selectionSetId, from, query }: Props) {
  const [items, setItems] = useState<RecentExportItem[]>([]);
  const [updatedAtISO, setUpdatedAtISO] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [pendingExportId, setPendingExportId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setIsUnauthorized(false);
    try {
      const response = await fetch('/api/timeline/exports/history?limit=10');
      if (response.status === 401) {
        setIsUnauthorized(true);
        setItems([]);
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load exports');
      }
      const payload = (await response.json()) as { items?: RecentExportItem[]; updatedAtISO?: string };
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setUpdatedAtISO(typeof payload.updatedAtISO === 'string' ? payload.updatedAtISO : null);
    } catch {
      setError('Unable to load exports.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownloadAgain = useCallback(
    async (item: RecentExportItem) => {
      if (!item.artifactIds.length || pendingExportId) return;
      setPendingExportId(item.exportId);
      setError(null);
      try {
        const response = await fetch('/api/timeline/export/pdf', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            artifactIds: item.artifactIds,
            source: {
              viewMode,
              ...(selectionSetId ? { selectionSetId } : {}),
              ...(query ? { query } : {}),
              ...(from ? { from } : {}),
            },
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to regenerate PDF');
        }

        const blob = await response.blob();
        await startDownload(blob, item.result.pdf?.filename ?? `timeline-report-${new Date().toISOString().slice(0, 10)}.pdf`);
      } catch {
        setError('Unable to download PDF again.');
      } finally {
        setPendingExportId(null);
      }
    },
    [from, pendingExportId, query, selectionSetId, viewMode],
  );

  const handleCopy = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setError('Unable to copy link.');
    }
  }, []);

  const content = useMemo(() => {
    if (isUnauthorized) {
      return <div className={styles.notice}>Sign in required</div>;
    }
    if (isLoading) {
      return <p className={styles.muted}>Loading recent exports…</p>;
    }
    if (error) {
      return (
        <div className={styles.noticeCard}>
          <div className={styles.notice}>{error}</div>
          <div className={styles.noticeActions}>
            <Button variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </div>
      );
    }
    if (!items.length) {
      return (
        <p className={styles.muted}>
          No exports yet. Export a report from the toolbar.
        </p>
      );
    }

    return (
      <div className={styles.recentExportsList}>
        {items.map((item) => (
          <div key={item.exportId} className={styles.recentExportRow}>
            <div>
              <div className={styles.badgeRow}>
                <span className={styles.recentFormat}>{item.format === 'pdf' ? 'PDF' : 'Drive Doc'}</span>
                <span className={styles.muted} title={new Date(item.createdAtISO).toLocaleString()}>
                  {relativeTime(item.createdAtISO)}
                </span>
              </div>
              <div className={styles.muted}>{item.artifactCount} artifacts</div>
              {item.source.selectionSetId || item.source.query ? (
                <div className={styles.muted}>
                  {item.source.selectionSetId ? `selection: ${item.source.selectionSetId}` : ''}
                  {item.source.selectionSetId && item.source.query ? ' · ' : ''}
                  {item.source.query ? `query: ${item.source.query}` : ''}
                </div>
              ) : null}
            </div>
            <div className={styles.selectionButtons}>
              {item.format === 'drive_doc' && item.result.driveDoc?.webViewLink ? (
                <>
                  <a href={item.result.driveDoc.webViewLink} target="_blank" rel="noreferrer" className={styles.driveLink}>
                    Open in Drive
                  </a>
                  <Button variant="ghost" onClick={() => void handleCopy(item.result.driveDoc!.webViewLink)}>
                    Copy link
                  </Button>
                </>
              ) : null}
              {item.format === 'pdf' ? (
                <Button
                  variant="secondary"
                  onClick={() => void handleDownloadAgain(item)}
                  disabled={pendingExportId === item.exportId}
                >
                  {pendingExportId === item.exportId ? 'Downloading…' : 'Download again'}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    );
  }, [error, handleCopy, handleDownloadAgain, isLoading, isUnauthorized, items, load, pendingExportId]);

  return (
    <Card>
      <div className={styles.indexHeader}>
        <h2>Recent exports</h2>
        {updatedAtISO ? <span className={styles.muted}>Updated {relativeTime(updatedAtISO)}</span> : null}
      </div>
      {content}
    </Card>
  );
}
