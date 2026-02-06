'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import type { SummaryArtifact } from '../lib/types';
import styles from './timeline.module.css';

type GmailSelection = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

type DriveSelection = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};

type TimelineItem = {
  kind: 'gmail' | 'drive';
  id: string;
  title: string;
  subtitle: string;
  timestamp?: string;
};

type SummarizeError = 'reconnect_required' | 'drive_not_provisioned' | 'generic' | null;

type FailedItem = {
  source: 'gmail' | 'drive';
  id: string;
  error: string;
};

const GMAIL_KEY = 'timeline.gmailSelections';
const DRIVE_KEY = 'timeline.driveSelections';
const ARTIFACTS_KEY = 'timeline.summaryArtifacts';
const ARTIFACT_LIMIT = 100;

const parseStoredSelections = <T,>(key: string) => {
  if (typeof window === 'undefined') {
    return [] as T[];
  }

  const stored = window.localStorage.getItem(key);
  if (!stored) {
    return [] as T[];
  }

  try {
    const parsed = JSON.parse(stored) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as T[];
  }
};

const parseStoredArtifacts = () => {
  if (typeof window === 'undefined') {
    return {} as Record<string, SummaryArtifact>;
  }

  const stored = window.localStorage.getItem(ARTIFACTS_KEY);
  if (!stored) {
    return {} as Record<string, SummaryArtifact>;
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, SummaryArtifact>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {} as Record<string, SummaryArtifact>;
  }
};

const artifactKey = (source: 'gmail' | 'drive', id: string) => `${source}:${id}`;

const persistArtifacts = (
  updates: SummaryArtifact[],
  existing: Record<string, SummaryArtifact>,
): Record<string, SummaryArtifact> => {
  const next = { ...existing };
  updates.forEach((artifact) => {
    next[artifactKey(artifact.source, artifact.sourceId)] = artifact;
  });

  const entries = Object.entries(next);
  if (entries.length > ARTIFACT_LIMIT) {
    entries.sort((a, b) => {
      const aTime = Date.parse(a[1].createdAtISO || '') || 0;
      const bTime = Date.parse(b[1].createdAtISO || '') || 0;
      return bTime - aTime;
    });

    const capped = Object.fromEntries(entries.slice(0, ARTIFACT_LIMIT));
    window.localStorage.setItem(ARTIFACTS_KEY, JSON.stringify(capped));
    return capped;
  }

  window.localStorage.setItem(ARTIFACTS_KEY, JSON.stringify(next));
  return next;
};

export default function TimelinePageClient() {
  const [gmailSelections, setGmailSelections] = useState<GmailSelection[]>([]);
  const [driveSelections, setDriveSelections] = useState<DriveSelection[]>([]);
  const [artifacts, setArtifacts] = useState<Record<string, SummaryArtifact>>({});
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<SummarizeError>(null);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setGmailSelections(parseStoredSelections<GmailSelection>(GMAIL_KEY));
    setDriveSelections(parseStoredSelections<DriveSelection>(DRIVE_KEY));
    setArtifacts(parseStoredArtifacts());
  }, []);

  const timelineItems = useMemo(() => {
    const gmailItems: TimelineItem[] = gmailSelections.map((message) => ({
      kind: 'gmail',
      id: message.id,
      title: message.subject,
      subtitle: message.from,
      timestamp: message.date,
    }));

    const driveItems: TimelineItem[] = driveSelections.map((file) => ({
      kind: 'drive',
      id: file.id,
      title: file.name,
      subtitle: file.mimeType,
      timestamp: file.modifiedTime,
    }));

    return [...gmailItems, ...driveItems].sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });
  }, [driveSelections, gmailSelections]);

  const summarizedCount = useMemo(
    () =>
      timelineItems.filter((item) =>
        Boolean(artifacts[artifactKey(item.kind, item.id)]?.summary),
      ).length,
    [artifacts, timelineItems],
  );

  const pendingCount = timelineItems.length - summarizedCount;

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSummarize = async () => {
    if (timelineItems.length === 0) {
      return;
    }

    setIsSummarizing(true);
    setError(null);
    setFailedItems([]);

    try {
      const response = await fetch('/api/timeline/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: timelineItems.map((item) => ({ source: item.kind, id: item.id })),
        }),
      });

      if (response.status === 401) {
        setError('reconnect_required');
        return;
      }

      if (response.status === 400) {
        const payload = (await response.json()) as { error?: string };
        if (payload?.error === 'drive_not_provisioned') {
          setError('drive_not_provisioned');
          return;
        }
        setError('generic');
        return;
      }

      if (!response.ok) {
        setError('generic');
        return;
      }

      const payload = (await response.json()) as {
        artifacts: SummaryArtifact[];
        failed: FailedItem[];
      };

      if (payload.artifacts?.length) {
        const next = persistArtifacts(payload.artifacts, artifacts);
        setArtifacts(next);
      }

      if (payload.failed?.length) {
        setFailedItems(payload.failed);
      }
    } catch {
      setError('generic');
    } finally {
      setIsSummarizing(false);
    }
  };

  const reconnectNotice = (
    <div className={styles.notice}>
      Reconnect required. Please <Link href="/connect">connect your Google account</Link>.
    </div>
  );

  const provisionNotice = (
    <div className={styles.notice}>
      Provision a Drive folder to store summaries. Visit <Link href="/connect">/connect</Link>.
    </div>
  );

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p>Unified view of the items you selected from Gmail and Drive.</p>
          <h1>Timeline selection</h1>
          <p className={styles.counts}>
            {timelineItems.length} selected, {summarizedCount} summarized, {pendingCount} pending
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={timelineItems.length === 0 || isSummarizing}
          onClick={handleSummarize}
        >
          {isSummarizing ? 'Generating...' : 'Generate summaries'}
        </Button>
      </div>

      {error === 'reconnect_required' ? reconnectNotice : null}
      {error === 'drive_not_provisioned' ? provisionNotice : null}
      {error === 'generic' ? (
        <div className={styles.notice}>Unable to generate summaries. Please try again.</div>
      ) : null}
      {failedItems.length > 0 ? (
        <div className={styles.notice}>
          Some items failed to summarize:
          <ul>
            {failedItems.map((item) => (
              <li key={`${item.source}-${item.id}`}>
                {item.source}:{item.id}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {timelineItems.length === 0 ? (
        <Card className={styles.emptyState}>
          <h2>No items selected yet</h2>
          <p>Pick Gmail and Drive items to create your first Timeline selection.</p>
        </Card>
      ) : (
        <div className={styles.list}>
          {timelineItems.map((item) => {
            const key = artifactKey(item.kind, item.id);
            const artifact = artifacts[key];
            const isExpanded = expandedKeys.has(key);
            const hasSummary = Boolean(artifact);
            const summaryText = artifact?.summary ?? '';
            const summaryExcerpt = summaryText.length > 180 ? `${summaryText.slice(0, 180)}…` : summaryText;

            return (
              <Card key={`${item.kind}-${item.id}`} className={styles.item}>
                <div className={styles.itemContent}>
                  <div className={styles.itemHeader}>
                    <h3>{item.title}</h3>
                    <Badge tone={hasSummary ? 'success' : 'warning'}>
                      {hasSummary ? 'Summarized' : 'Pending'}
                    </Badge>
                  </div>
                  <p className={styles.subtitle}>{item.subtitle}</p>
                  <p className={styles.timestamp}>{item.timestamp ?? '—'}</p>
                  {hasSummary ? (
                    <div className={styles.summaryBlock}>
                      <p className={styles.summaryText}>{isExpanded ? summaryText : summaryExcerpt}</p>
                      {isExpanded && artifact?.highlights?.length ? (
                        <ul className={styles.highlights}>
                          {artifact.highlights.map((highlight, index) => (
                            <li key={`${key}-highlight-${index}`}>{highlight}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className={styles.summaryActions}>
                        <Button variant="ghost" onClick={() => toggleExpanded(key)}>
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </Button>
                        {artifact?.driveWebViewLink ? (
                          <a
                            className={styles.driveLink}
                            href={artifact.driveWebViewLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Drive
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
