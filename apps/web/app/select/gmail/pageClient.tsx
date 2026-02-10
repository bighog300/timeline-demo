'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { buildGmailQuery, DateRangePreset, parseSender } from '../../lib/gmailQuery';
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

type SenderSuggestion = {
  email: string;
  name: string;
  count: number;
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
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
  const [senderInput, setSenderInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [daysBack, setDaysBack] = useState<DateRangePreset>('30');
  const [customAfter, setCustomAfter] = useState('');
  const [hasAttachment, setHasAttachment] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const senderSuggestions = useMemo(() => {
    const frequencyMap = new Map<string, SenderSuggestion>();

    for (const message of messages) {
      const parsed = parseSender(message.from);
      if (!parsed) {
        continue;
      }

      const existing = frequencyMap.get(parsed.email);
      if (existing) {
        existing.count += 1;
      } else {
        frequencyMap.set(parsed.email, { email: parsed.email, name: parsed.name, count: 1 });
      }
    }

    const query = senderInput.trim().toLowerCase();
    return Array.from(frequencyMap.values())
      .filter((sender) => {
        if (selectedSenders.includes(sender.email)) {
          return false;
        }

        if (!query) {
          return true;
        }

        return (
          sender.email.toLowerCase().includes(query) || sender.name.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [messages, selectedSenders, senderInput]);

  const normalizedSenders = useMemo(() => selectedSenders.map((sender) => sender.toLowerCase()), [selectedSenders]);

  const senderMatchedMessages = useMemo(() => {
    if (normalizedSenders.length === 0) {
      return [] as GmailMessage[];
    }

    const selected = new Set(normalizedSenders);
    return messages.filter((message) => {
      const parsed = parseSender(message.from);
      return parsed ? selected.has(parsed.email) : false;
    });
  }, [messages, normalizedSenders]);

  const queryPreview = useMemo(
    () =>
      buildGmailQuery({
        senders: selectedSenders,
        daysBack,
        customAfter,
        hasAttachment,
        freeText,
      }),
    [selectedSenders, daysBack, customAfter, hasAttachment, freeText],
  );

  const toggleSelection = (messageId: string) => {
    setSelectedIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId],
    );
  };

  const addSender = (rawSender: string) => {
    const value = rawSender.trim().toLowerCase();
    if (!value || selectedSenders.includes(value)) {
      return;
    }

    setSelectedSenders((prev) => [...prev, value]);
    setSenderInput('');
    setShowSuggestions(false);
  };

  const addSelectedRecentFromSenders = () => {
    if (senderMatchedMessages.length === 0) {
      setNotice('No matches in recent emails; use Search (Phase 2).');
      return;
    }

    const existing = parseStoredSelections();
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of senderMatchedMessages) {
      byId.set(message.id, message);
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(byId.values())));
    setSelectedIds(Array.from(new Set([...selectedIds, ...senderMatchedMessages.map((m) => m.id)])));
    setNotice(
      `Added ${senderMatchedMessages.length} emails from selected senders (from recent list). Refine and search for older emails in Phase 2.`,
    );
  };

  const handleSave = () => {
    const selectedMessages = messages.filter((message) => selectedSet.has(message.id));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedMessages));
    setNotice('Saved selected emails to Timeline selection.');
  };

  const handleSearch = () => {
    if (selectedSenders.length === 0) {
      setNotice('Choose at least one sender before searching.');
      return;
    }

    if (!queryPreview) {
      setNotice('Query is empty. Adjust filters to continue.');
      return;
    }

    if (daysBack === 'custom' && customAfter && Number.isNaN(new Date(customAfter).getTime())) {
      setNotice('Custom date is invalid.');
      return;
    }

    setPendingSearch(queryPreview);
    setNotice(null);
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
          <p className={styles.muted}>This app only processes emails you explicitly select.</p>
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
      {notice ? <div className={styles.noticeNeutral}>{notice}</div> : null}

      <section className={styles.panel}>
        <h2>Sender filter</h2>
        <div className={styles.senderRow}>
          <input
            className={styles.input}
            value={senderInput}
            placeholder="Add sender email"
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onChange={(event) => setSenderInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addSender(senderInput);
              }
            }}
          />
          <Button onClick={() => addSender(senderInput)} variant="secondary" disabled={!senderInput.trim()}>
            Add sender
          </Button>
        </div>

        {showSuggestions && senderSuggestions.length > 0 ? (
          <div className={styles.suggestions}>
            {senderSuggestions.map((sender) => (
              <button
                key={sender.email}
                className={styles.suggestion}
                onMouseDown={(event) => {
                  event.preventDefault();
                  addSender(sender.email);
                }}
                type="button"
              >
                <span>{sender.name}</span>
                <span className={styles.itemMeta}>{sender.email}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.chips}>
          {selectedSenders.map((sender) => (
            <button
              key={sender}
              type="button"
              className={styles.chip}
              onClick={() => setSelectedSenders((prev) => prev.filter((item) => item !== sender))}
            >
              {sender} ×
            </button>
          ))}
          {selectedSenders.length === 0 ? <p className={styles.muted}>No senders selected yet.</p> : null}
        </div>

        <div className={styles.filtersGrid}>
          <label className={styles.field}>
            Date range
            <select value={daysBack} onChange={(event) => setDaysBack(event.target.value as DateRangePreset)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom start date</option>
            </select>
          </label>

          {daysBack === 'custom' ? (
            <label className={styles.field}>
              After date
              <input type="date" value={customAfter} onChange={(event) => setCustomAfter(event.target.value)} />
            </label>
          ) : null}

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={hasAttachment}
              onChange={(event) => setHasAttachment(event.target.checked)}
            />
            Has attachment
          </label>

          <label className={styles.field}>
            Free text
            <input
              type="text"
              value={freeText}
              placeholder="e.g. invoice status"
              onChange={(event) => setFreeText(event.target.value)}
            />
          </label>
        </div>

        <div className={styles.previewBox}>
          <strong>Build query</strong>
          <code>{queryPreview || '(query will appear here)'}</code>
        </div>

        <div className={styles.actions}>
          <Button
            onClick={addSelectedRecentFromSenders}
            variant="secondary"
            disabled={selectedSenders.length === 0}
          >
            Add from senders (recent only)
          </Button>
          <Button onClick={handleSearch} variant="secondary">
            Search
          </Button>
        </div>

        {selectedSenders.length > 0 && senderMatchedMessages.length === 0 ? (
          <p className={styles.muted}>No matches in recent emails; use Search (Phase 2).</p>
        ) : null}

        {pendingSearch ? (
          <div className={styles.emptyState}>
            <p>Search endpoint not wired yet (Phase 2).</p>
            <p className={styles.muted}>Pending query: {pendingSearch}</p>
          </div>
        ) : null}
      </section>

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
