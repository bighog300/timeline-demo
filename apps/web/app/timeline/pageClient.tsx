'use client';

import React, { useEffect, useMemo, useState } from 'react';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
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

type TimelineItem =
  | { kind: 'gmail'; id: string; title: string; subtitle: string; timestamp?: string }
  | { kind: 'drive'; id: string; title: string; subtitle: string; timestamp?: string };

const GMAIL_KEY = 'timeline.gmailSelections';
const DRIVE_KEY = 'timeline.driveSelections';

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

export default function TimelinePageClient() {
  const [gmailSelections, setGmailSelections] = useState<GmailSelection[]>([]);
  const [driveSelections, setDriveSelections] = useState<DriveSelection[]>([]);

  useEffect(() => {
    setGmailSelections(parseStoredSelections<GmailSelection>(GMAIL_KEY));
    setDriveSelections(parseStoredSelections<DriveSelection>(DRIVE_KEY));
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

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p>Unified view of the items you selected from Gmail and Drive.</p>
          <h1>Timeline selection</h1>
        </div>
        <Button variant="secondary" disabled>
          Generate summary (Phase 2)
        </Button>
      </div>

      {timelineItems.length === 0 ? (
        <Card className={styles.emptyState}>
          <h2>No items selected yet</h2>
          <p>Pick Gmail and Drive items to create your first Timeline selection.</p>
        </Card>
      ) : (
        <div className={styles.list}>
          {timelineItems.map((item) => (
            <Card key={`${item.kind}-${item.id}`} className={styles.item}>
              <div>
                <div className={styles.itemHeader}>
                  <h3>{item.title}</h3>
                  <Badge tone="warning">Not yet summarized</Badge>
                </div>
                <p className={styles.subtitle}>{item.subtitle}</p>
                <p className={styles.timestamp}>{item.timestamp ?? '—'}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
