'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { parseApiError } from '../../lib/apiErrors';
import { buildGmailQuery, DateRangePreset, parseSender } from '../../lib/gmailQuery';
import type { GmailSelectionSet } from '../../lib/selectionSets';
import { hydrateGmailQueryControls } from './selectionSetHydration';
import styles from '../selection.module.css';

type GmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

type GmailSearchMessage = {
  id: string;
  threadId: string;
  internalDate: number;
  snippet: string;
  from: {
    name: string;
    email: string;
  };
  subject: string;
  date: string;
};

type GmailSelectClientProps = {
  isConfigured: boolean;
};

type SenderSuggestion = {
  email: string;
  name: string;
  count: number;
};

type SavedSelectionSetMetadata = {
  id: string;
  title: string;
  updatedAt: string;
};

const STORAGE_KEY = 'timeline.gmailSelections';
const DEFAULT_DAYS_BACK: DateRangePreset = '30';
const SOFT_SENDER_WARNING_THRESHOLD = 10;
const HARD_SENDER_LIMIT = 20;
const MAX_SELECTION_ITEMS = 500;
const MAX_SUMMARIZE_SELECTION = 20;
const TIMELINE_SUMMARIZE_BATCH_SIZE = 10;

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
  const [daysBack, setDaysBack] = useState<DateRangePreset>(DEFAULT_DAYS_BACK);
  const [customAfter, setCustomAfter] = useState('');
  const [hasAttachment, setHasAttachment] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRequestId, setSearchRequestId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<GmailSearchMessage[]>([]);
  const [searchSelectedIds, setSearchSelectedIds] = useState<string[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [searchSourceLabel, setSearchSourceLabel] = useState<string | null>(null);
  const [savedSets, setSavedSets] = useState<SavedSelectionSetMetadata[]>([]);
  const [savedSetsLoading, setSavedSetsLoading] = useState(false);
  const [isSummarizingSelected, setIsSummarizingSelected] = useState(false);
  const [summarizeStatus, setSummarizeStatus] = useState<string | null>(null);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [summarizeRequestId, setSummarizeRequestId] = useState<string | null>(null);
  const [summarizedCount, setSummarizedCount] = useState<number | null>(null);

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

  const loadSavedSelectionSets = async () => {
    setSavedSetsLoading(true);
    const response = await fetch('/api/selection-sets');
    if (response.status === 401) {
      setError('reconnect_required');
      setSavedSetsLoading(false);
      return;
    }

    if (!response.ok) {
      setSavedSetsLoading(false);
      return;
    }

    const payload = (await response.json()) as { sets?: SavedSelectionSetMetadata[] };
    setSavedSets(payload.sets ?? []);
    setSavedSetsLoading(false);
  };

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    void loadSavedSelectionSets();
  }, [isConfigured]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const senderSuggestions = useMemo(() => {
    const frequencyMap = new Map<string, SenderSuggestion>();

    for (const message of messages) {
      const parsed = parseSender(message.from);
      if (!parsed.email) {
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
          sender.email.includes(query) || sender.name.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }

        return a.email.localeCompare(b.email);
      })
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
      return parsed.email ? selected.has(parsed.email) : false;
    });
  }, [messages, normalizedSenders]);

  const senderMatchCount = senderMatchedMessages.length;

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

    if (selectedSenders.length >= HARD_SENDER_LIMIT) {
      setNotice('Limit 20 senders; refine selection.');
      return;
    }

    setSelectedSenders((prev) => [...prev, value]);
    setSenderInput('');
    setShowSuggestions(false);
    setNotice(null);
  };

  const resetFilters = () => {
    setSelectedSenders([]);
    setSenderInput('');
    setDaysBack(DEFAULT_DAYS_BACK);
    setCustomAfter('');
    setHasAttachment(false);
    setFreeText('');
    setPendingSearch(null);
    setSearchResults([]);
    setSearchSelectedIds([]);
    setSearchError(null);
    setSearchRequestId(null);
    setNextPageToken(null);
    setResultCount(0);
    setSearchQuery(null);
    setSearchSourceLabel(null);
    setShowSuggestions(false);
    setNotice(null);
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

    const merged = Array.from(byId.values());
    if (merged.length > MAX_SELECTION_ITEMS) {
      const capped = merged.slice(0, MAX_SELECTION_ITEMS);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
      setSelectedIds(Array.from(new Set(capped.map((message) => message.id))));
      setNotice('Selection capped at 500 items; refine filters.');
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    setSelectedIds(Array.from(new Set([...selectedIds, ...senderMatchedMessages.map((message) => message.id)])));
    setNotice(
      `Added ${senderMatchedMessages.length} emails from selected senders (from recent list). Refine and search for older emails in Phase 2.`,
    );
  };

  const handleSave = () => {
    const selectedMessages = messages.filter((message) => selectedSet.has(message.id));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedMessages));
    setNotice('Saved selected emails to Timeline selection.');
  };

  const toStoredMessage = (message: GmailSearchMessage): GmailMessage => ({
    id: message.id,
    threadId: message.threadId,
    subject: message.subject,
    from: message.from.name && message.from.email ? `${message.from.name} <${message.from.email}>` : message.from.name || message.from.email,
    date: message.date,
    snippet: message.snippet,
  });

  const mergeIntoLocalStorage = (incoming: GmailMessage[], successNotice: string) => {
    const existing = parseStoredSelections();
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of incoming) {
      byId.set(message.id, message);
    }

    const merged = Array.from(byId.values());
    if (merged.length > MAX_SELECTION_ITEMS) {
      const capped = merged.slice(0, MAX_SELECTION_ITEMS);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
      setSelectedIds(Array.from(new Set(capped.map((message) => message.id))));
      setNotice('Selection capped at 500 items; refine filters.');
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    setSelectedIds(Array.from(new Set(merged.map((message) => message.id))));
    setNotice(successNotice);
  };

  const executeSearch = async ({ q, sourceLabel, pageToken }: { q: string; sourceLabel: string; pageToken: string | null }) => {
    const trimmedQuery = q.trim();
    if (!trimmedQuery) {
      setNotice('Query is empty. Adjust filters to continue.');
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    setSearchRequestId(null);

    const response = await fetch('/api/google/gmail/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: trimmedQuery, maxResults: 50, pageToken }),
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      code?: string;
      message?: string;
      requestId?: string;
      resultCount?: number;
      nextPageToken?: string | null;
      messages?: GmailSearchMessage[];
    };

    if (!response.ok) {
      setSearchLoading(false);
      setSearchRequestId(payload.requestId ?? null);
      if (payload.code === 'reconnect_required') {
        setError('reconnect_required');
        return;
      }

      if (response.status === 429 || payload.code === 'rate_limited') {
        setSearchError('Rate limited by Gmail. Please wait a moment and retry.');
        return;
      }

      if (response.status >= 500) {
        setSearchError(`Search failed. Please retry. Request ID: ${payload.requestId ?? 'unknown'}`);
        return;
      }

      setSearchError(payload.message ?? 'Search failed.');
      return;
    }

    setPendingSearch(trimmedQuery);
    setSearchLoading(false);
    setSearchResults(payload.messages ?? []);
    setSearchSelectedIds([]);
    setResultCount(payload.resultCount ?? 0);
    setNextPageToken(payload.nextPageToken ?? null);
    setSearchRequestId(payload.requestId ?? null);
    setSearchQuery(trimmedQuery);
    setSearchSourceLabel(sourceLabel);
    setNotice(null);
  };

  const searchSelectionSet = useMemo(() => new Set(searchSelectedIds), [searchSelectedIds]);

  const toggleSearchSelection = (messageId: string) => {
    setSearchSelectedIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId],
    );
  };

  const summarizeSelectedNow = async () => {
    const selected = searchResults.filter((message) => searchSelectionSet.has(message.id));
    if (selected.length === 0 || selected.length > MAX_SUMMARIZE_SELECTION) {
      return;
    }

    setIsSummarizingSelected(true);
    setSummarizeStatus('Summarizing…');
    setSummarizeError(null);
    setSummarizeRequestId(null);
    setSummarizedCount(null);

    try {
      let totalArtifacts = 0;

      for (let index = 0; index < selected.length; index += TIMELINE_SUMMARIZE_BATCH_SIZE) {
        const batch = selected.slice(index, index + TIMELINE_SUMMARIZE_BATCH_SIZE);
        const response = await fetch('/api/timeline/summarize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            items: batch.map((message) => ({ source: 'gmail', id: message.id })),
          }),
        });

        if (!response.ok) {
          const apiError = await parseApiError(response);
          setSummarizeRequestId(apiError?.requestId ?? null);
          if (apiError?.code === 'reconnect_required') {
            setSummarizeError('reconnect_required');
            setSummarizeStatus(null);
            return;
          }
          if (apiError?.code === 'rate_limited') {
            setSummarizeError('rate_limited');
            setSummarizeStatus(null);
            return;
          }
          if (response.status >= 500 || apiError?.code === 'upstream_timeout' || apiError?.code === 'upstream_error') {
            setSummarizeError('server_error');
            setSummarizeStatus(null);
            return;
          }

          setSummarizeError('generic');
          setSummarizeStatus(null);
          return;
        }

        const payload = (await response.json()) as { artifacts?: Array<{ sourceId?: string }> };
        totalArtifacts += payload.artifacts?.length ?? 0;
      }

      setSummarizedCount(totalArtifacts);
      setSummarizeStatus(null);
      setSummarizeError(null);
      setSearchSelectedIds([]);
    } catch {
      setSummarizeStatus(null);
      setSummarizeError('generic');
      setSummarizeRequestId(null);
    } finally {
      setIsSummarizingSelected(false);
    }
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

    if (selectedSenders.length === 0 && !freeText.trim()) {
      setNotice('This query may be too broad. Add sender(s) or text before searching.');
      return;
    }

    void executeSearch({ q: queryPreview, sourceLabel: 'Manual search', pageToken: null });
  };

  const toPersistedDatePreset = (value: DateRangePreset): '7d' | '30d' | '90d' | 'custom' => {
    if (value === '7') {
      return '7d';
    }
    if (value === '30') {
      return '30d';
    }
    if (value === '90') {
      return '90d';
    }
    return 'custom';
  };

  const saveSelectionSet = async () => {
    if (!queryPreview) {
      setNotice('Query is empty. Adjust filters to continue.');
      return;
    }

    const defaultTitle = `${selectedSenders[0] ?? 'Gmail search'} · ${daysBack === 'custom' ? 'Custom date' : `${daysBack} days`}`;
    const rawTitle = window.prompt('Save search as selection set', defaultTitle);
    if (!rawTitle) {
      return;
    }

    const title = rawTitle.trim();
    if (!title) {
      setNotice('Selection set title is required.');
      return;
    }

    const titleExists = savedSets.some((set) => set.title.toLowerCase() === title.toLowerCase());
    if (titleExists) {
      const shouldContinue = window.confirm('A saved search with this title already exists. Save anyway?');
      if (!shouldContinue) {
        return;
      }
    }

    const response = await fetch('/api/selection-sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        query: {
          q: queryPreview,
          senders: selectedSenders,
          datePreset: toPersistedDatePreset(daysBack),
          customAfter: daysBack === 'custom' && customAfter ? new Date(customAfter).toISOString() : null,
          hasAttachment,
          freeText,
        },
      }),
    });

    if (response.status === 401) {
      setError('reconnect_required');
      return;
    }

    if (!response.ok) {
      setNotice('Unable to save selection set. Please try again.');
      return;
    }

    setNotice(`Saved search as "${title}".`);
    await loadSavedSelectionSets();
  };

  const applySavedSelectionSet = async (id: string) => {
    const response = await fetch(`/api/selection-sets/${id}`);
    if (response.status === 401) {
      setError('reconnect_required');
      return;
    }

    if (!response.ok) {
      setNotice('Unable to load selection set.');
      return;
    }

    const payload = (await response.json()) as { set?: GmailSelectionSet };
    if (!payload.set) {
      setNotice('Saved search payload was empty.');
      return;
    }

    const hydrated = hydrateGmailQueryControls(payload.set);
    setSelectedSenders(hydrated.selectedSenders);
    setDaysBack(hydrated.daysBack);
    setCustomAfter(hydrated.customAfter);
    setHasAttachment(hydrated.hasAttachment);
    setFreeText(hydrated.freeText);
    setPendingSearch(null);
    setSearchResults([]);
    setSearchSelectedIds([]);
    setSearchError(null);
    setSearchRequestId(null);
    setNextPageToken(null);
    setResultCount(0);
    setSearchQuery(null);
    setSearchSourceLabel(null);
    setNotice(`Loaded saved search "${payload.set.title}". Click Search to run it.`);
  };

  const runSavedSelectionSet = async (id: string) => {
    const response = await fetch(`/api/selection-sets/${id}`);
    if (response.status === 401) {
      setError('reconnect_required');
      return;
    }

    if (!response.ok) {
      setNotice('Unable to load selection set.');
      return;
    }

    const payload = (await response.json()) as { set?: GmailSelectionSet };
    if (!payload.set) {
      setNotice('Saved search payload was empty.');
      return;
    }

    const canonicalQuery = payload.set.query?.q?.trim();
    if (!canonicalQuery) {
      setNotice('Saved search query is empty. Update the saved search and try again.');
      return;
    }

    await executeSearch({
      q: canonicalQuery,
      sourceLabel: `Saved search: ${payload.set.title}`,
      pageToken: null,
    });
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
        <div className={styles.panelHeader}>
          <h2>Saved searches</h2>
          <Button variant="secondary" onClick={saveSelectionSet} disabled={!queryPreview}>
            Save search as selection set
          </Button>
        </div>
        {savedSetsLoading ? <p className={styles.muted}>Loading saved searches...</p> : null}
        {!savedSetsLoading && savedSets.length === 0 ? (
          <p className={styles.muted}>No saved searches yet.</p>
        ) : null}
        <div className={styles.savedSetList}>
          {savedSets.map((set) => (
            <div key={set.id} className={styles.savedSetItem}>
              <span className={styles.savedSetTitle}>{set.title}</span>
              <span className={styles.itemMeta}>{new Date(set.updatedAt).toLocaleString()}</span>
              <div className={styles.savedSetActions}>
                <Button variant="secondary" onClick={() => void applySavedSelectionSet(set.id)} disabled={isSummarizingSelected}>
                  Apply
                </Button>
                <Button variant="secondary" onClick={() => void runSavedSelectionSet(set.id)} disabled={isSummarizingSelected}>
                  Run
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Sender filter</h2>
          <button type="button" className={styles.clearButton} onClick={resetFilters}>
            Clear filters
          </button>
        </div>
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
          <Button
            onClick={() => addSender(senderInput)}
            variant="secondary"
            disabled={!senderInput.trim() || selectedSenders.length >= HARD_SENDER_LIMIT}
          >
            Add sender
          </Button>
        </div>

        {selectedSenders.length >= HARD_SENDER_LIMIT ? (
          <p className={styles.noticeWarning}>Limit 20 senders; refine selection.</p>
        ) : null}
        {selectedSenders.length >= SOFT_SENDER_WARNING_THRESHOLD && selectedSenders.length < HARD_SENDER_LIMIT ? (
          <p className={styles.noticeSubtle}>Using many senders can broaden results; refine if possible.</p>
        ) : null}

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
                disabled={selectedSenders.length >= HARD_SENDER_LIMIT}
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
          <span className={styles.matchCountLabel}>
            {senderMatchCount > 0
              ? `${senderMatchCount} matches in recent emails`
              : 'No matches in recent emails; use Search (Phase 2).' }
          </span>
          <Button onClick={handleSearch} variant="secondary" disabled={isSummarizingSelected}>
            Search
          </Button>
        </div>

        {searchError ? <p className={styles.noticeWarning}>{searchError}</p> : null}

        {pendingSearch ? (
          <section className={styles.resultsPanel}>
            <div className={styles.panelHeader}>
              <h2>Results ({resultCount})</h2>
              <span className={styles.itemMeta}>{searchSourceLabel ?? 'Search'} · Query: {pendingSearch}</span>
            </div>

            {resultCount >= 50 && nextPageToken ? (
              <p className={styles.noticeSubtle}>Showing first 50 results. Narrow your filters or paginate.</p>
            ) : null}

            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => {
                  if (searchResults.length === 0) {
                    setNotice('No results on this page to add.');
                    return;
                  }

                  mergeIntoLocalStorage(
                    searchResults.map(toStoredMessage),
                    `Added ${searchResults.length} emails from this page to Timeline selection.`,
                  );
                }}
                disabled={searchResults.length === 0 || isSummarizingSelected}
              >
                Add all (this page) to Timeline
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const selected = searchResults.filter((message) => searchSelectionSet.has(message.id));
                  if (selected.length === 0) {
                    setNotice('Select at least one message to add.');
                    return;
                  }

                  mergeIntoLocalStorage(
                    selected.map(toStoredMessage),
                    `Added ${selected.length} selected emails to Timeline selection.`,
                  );
                }}
                disabled={searchSelectedIds.length === 0}
              >
                Add selected to Timeline
              </Button>
              <Button
                onClick={() => void summarizeSelectedNow()}
                className={styles.summarizeNowButton}
                disabled={
                  searchSelectedIds.length === 0 ||
                  searchSelectedIds.length > MAX_SUMMARIZE_SELECTION ||
                  isSummarizingSelected
                }
              >
                Summarize selected now
              </Button>
              <Button
                variant="secondary"
                onClick={() => setSearchSelectedIds(searchResults.map((message) => message.id))}
                disabled={searchResults.length === 0 || isSummarizingSelected}
              >
                Select all (this page)
              </Button>
              <Button variant="secondary" onClick={() => setSearchSelectedIds([])} disabled={searchSelectedIds.length === 0 || isSummarizingSelected}>
                Clear selection
              </Button>
              <Badge tone="neutral">{searchSelectedIds.length} selected on page</Badge>
            </div>

            {searchSelectedIds.length > MAX_SUMMARIZE_SELECTION ? (
              <p className={styles.noticeWarning}>Select up to 20 emails to summarize at once.</p>
            ) : null}

            {summarizeStatus ? <p className={styles.noticeSubtle}>{summarizeStatus}</p> : null}
            {summarizedCount !== null ? (
              <div className={styles.noticeSuccess}>
                Summarized {summarizedCount} emails. <Link href="/timeline">Open Timeline</Link>
              </div>
            ) : null}
            {summarizeError === 'reconnect_required' ? (
              <div className={styles.notice}>
                Google connection expired. <Link href="/connect">Reconnect</Link> and retry.
              </div>
            ) : null}
            {summarizeError === 'rate_limited' ? (
              <p className={styles.noticeNeutral}>Rate limited while summarizing. Please wait a moment and retry.</p>
            ) : null}
            {summarizeError === 'server_error' ? (
              <p className={styles.noticeWarning}>
                Something went wrong.
                {summarizeRequestId ? ` Request ID: ${summarizeRequestId}` : ''}
              </p>
            ) : null}
            {summarizeError === 'generic' ? (
              <p className={styles.noticeWarning}>
                Unable to summarize selected emails.
                {summarizeRequestId ? ` Request ID: ${summarizeRequestId}` : ''}
              </p>
            ) : null}

            {searchLoading ? <p className={styles.muted}>Searching Gmail…</p> : null}

            <div className={styles.list}>
              {searchResults.map((message) => (
                <label key={message.id} className={styles.item}>
                  <input
                    type="checkbox"
                    checked={searchSelectionSet.has(message.id)}
                    onChange={() => toggleSearchSelection(message.id)}
                    disabled={isSummarizingSelected}
                  />
                  <div>
                    <div className={styles.itemHeader}>
                      <strong>{message.subject || '(no subject)'}</strong>
                      <span className={styles.itemMeta}>{new Date(message.internalDate).toLocaleString()}</span>
                    </div>
                    <p className={styles.itemMeta}>
                      {message.from.name || message.from.email}
                      {message.from.email && message.from.name !== message.from.email ? ` <${message.from.email}>` : ''}
                    </p>
                    <p className={styles.itemMeta}>{message.date}</p>
                    <p className={styles.muted}>{message.snippet}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => {
                  if (!searchQuery) {
                    setNotice('No active query. Run a search first.');
                    return;
                  }

                  void executeSearch({ q: searchQuery, sourceLabel: searchSourceLabel ?? 'Search', pageToken: nextPageToken });
                }}
                disabled={!nextPageToken || searchLoading || isSummarizingSelected}
              >
                Next page
              </Button>
              {searchRequestId ? <span className={styles.itemMeta}>Request ID: {searchRequestId}</span> : null}
            </div>
          </section>
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
