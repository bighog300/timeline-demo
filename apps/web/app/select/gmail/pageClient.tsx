'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import styles from '../selection.module.css';

type GmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

type GmailSelectClientProps = {
  isConfigured: boolean;
};

const STORAGE_KEY = 'timeline.gmailSelections';

const parseStoredSelections = () => {
  if (typeof window === 'undefined') {
    return [] as GmailMessage[];
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [] as GmailMessage[];
  }

  try {
    const parsed = JSON.parse(stored) as GmailMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as GmailMessage[];
  }
};

export default function GmailSelectClient({ isConfigured }: GmailSelectClientProps) {
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds(parseStoredSelections().map((item) => item.id));
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const fetchMessages = async () => {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/google/gmail/list');
      if (response.status === 401) {
        setError('reconnect_required');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        setError('Unable to load Gmail messages.');
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as { messages: GmailMessage[] };
      setMessages(payload.messages ?? []);
      setLoading(false);
    };

    fetchMessages();
  }, [isConfigured]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleSelection = (messageId: string) => {
    setSelectedIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId],
    );
  };

  const handleSave = () => {
    const selectedMessages = messages.filter((message) => selectedSet.has(message.id));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedMessages));
  };

  const reconnectNotice = (
    <div className={styles.notice}>
      Reconnect required. Please <Link href="/connect">connect your Google account</Link>.
    </div>
  );

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p>Choose Gmail messages to include in your Timeline selection.</p>
          <h1>Gmail selection</h1>
        </div>
        <div className={styles.actions}>
          <Button
            onClick={handleSave}
            variant="primary"
            disabled={selectedIds.length === 0 || messages.length === 0}
          >
            Add to Timeline selection
          </Button>
          <Badge tone="neutral">{selectedIds.length} selected</Badge>
        </div>
      </div>

      {!isConfigured ? (
        <div className={styles.emptyState}>
          Google OAuth isn&apos;t configured yet. Add the required environment variables to enable
          Gmail selection.
        </div>
      ) : null}

      {error === 'reconnect_required' ? reconnectNotice : null}
      {error && error !== 'reconnect_required' ? <div className={styles.notice}>{error}</div> : null}

      {loading ? <p className={styles.muted}>Loading Gmail messages...</p> : null}

      {!loading && messages.length === 0 && isConfigured ? (
        <div className={styles.emptyState}>No recent Gmail messages found.</div>
      ) : null}

      <div className={styles.list}>
        {messages.map((message) => (
          <label key={message.id} className={styles.item}>
            <input
              type="checkbox"
              checked={selectedSet.has(message.id)}
              onChange={() => toggleSelection(message.id)}
            />
            <div>
              <div className={styles.itemHeader}>
                <strong>{message.subject}</strong>
                <span className={styles.itemMeta}>{message.date}</span>
              </div>
              <p className={styles.itemMeta}>{message.from}</p>
              <p className={styles.muted}>{message.snippet}</p>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
