'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { artifactKey, mergeArtifacts } from '../lib/artifactMerge';
import { mergeSelectionItems } from '../lib/selectionMerge';
import type { SelectionSet, SelectionSetItem, SummaryArtifact } from '../lib/types';
import { isSummaryArtifact, normalizeArtifact } from '../lib/validateArtifact';
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
type SyncError = 'reconnect_required' | 'drive_not_provisioned' | 'generic' | null;
type SelectionSetError = 'reconnect_required' | 'drive_not_provisioned' | 'generic' | null;

type FailedItem = {
  source: 'gmail' | 'drive';
  id: string;
  error: string;
};

type SelectionSetSummary = {
  driveFileId: string;
  name: string;
  updatedAtISO: string;
  driveWebViewLink?: string;
};

type SearchType = 'all' | 'summary' | 'selection';

type TimelineSearchResult = {
  kind: 'summary' | 'selection';
  driveFileId: string;
  driveWebViewLink?: string;
  title: string;
  updatedAtISO?: string;
  snippet: string;
  matchFields: string[];
};

type SearchError =
  | 'reconnect_required'
  | 'drive_not_provisioned'
  | 'query_too_short'
  | 'query_too_long'
  | 'generic'
  | null;

const GMAIL_KEY = 'timeline.gmailSelections';
const DRIVE_KEY = 'timeline.driveSelections';
const ARTIFACTS_KEY = 'timeline.summaryArtifacts';
const AUTO_SYNC_KEY = 'timeline.autoSyncOnOpen';
const LAST_SYNC_KEY = 'timeline.lastSyncISO';
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

const persistArtifacts = (
  updates: SummaryArtifact[],
  existing: Record<string, SummaryArtifact>,
): Record<string, SummaryArtifact> => {
  const merged = mergeArtifacts(existing, updates, ARTIFACT_LIMIT);
  window.localStorage.setItem(ARTIFACTS_KEY, JSON.stringify(merged));
  return merged;
};

const buildSelectionItems = (
  gmailSelections: GmailSelection[],
  driveSelections: DriveSelection[],
): SelectionSetItem[] => [
  ...gmailSelections.map((message) => ({
    source: 'gmail' as const,
    id: message.id,
    title: message.subject,
    dateISO: message.date,
  })),
  ...driveSelections.map((file) => ({
    source: 'drive' as const,
    id: file.id,
    title: file.name,
    dateISO: file.modifiedTime,
  })),
];

const selectionItemsToSelections = (
  items: SelectionSetItem[],
  gmailSelections: GmailSelection[],
  driveSelections: DriveSelection[],
) => {
  const gmailById = new Map(gmailSelections.map((message) => [message.id, message]));
  const driveById = new Map(driveSelections.map((file) => [file.id, file]));

  const nextGmail: GmailSelection[] = [];
  const nextDrive: DriveSelection[] = [];

  items.forEach((item) => {
    if (item.source === 'gmail') {
      const existing = gmailById.get(item.id);
      nextGmail.push(
        existing ?? {
          id: item.id,
          threadId: item.id,
          subject: item.title ?? 'Untitled message',
          from: 'From unavailable',
          date: item.dateISO ?? '',
          snippet: '',
        },
      );
      return;
    }

    const existing = driveById.get(item.id);
    nextDrive.push(
      existing ?? {
        id: item.id,
        name: item.title ?? 'Untitled file',
        mimeType: 'application/octet-stream',
        modifiedTime: item.dateISO,
      },
    );
  });

  return { gmail: nextGmail, drive: nextDrive };
};

export default function TimelinePageClient() {
  const [gmailSelections, setGmailSelections] = useState<GmailSelection[]>([]);
  const [driveSelections, setDriveSelections] = useState<DriveSelection[]>([]);
  const [artifacts, setArtifacts] = useState<Record<string, SummaryArtifact>>({});
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<SummarizeError>(null);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<SyncError>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [autoSyncOnOpen, setAutoSyncOnOpen] = useState(false);
  const [lastSyncISO, setLastSyncISO] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [selectionSets, setSelectionSets] = useState<SelectionSetSummary[]>([]);
  const [isLoadingSets, setIsLoadingSets] = useState(false);
  const [selectionError, setSelectionError] = useState<SelectionSetError>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [selectionPreview, setSelectionPreview] = useState<SelectionSet | null>(null);
  const [previewError, setPreviewError] = useState<SelectionSetError>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveNotes, setSaveNotes] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToExisting, setSaveToExisting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('all');
  const [searchResults, setSearchResults] = useState<TimelineSearchResult[]>([]);
  const [searchError, setSearchError] = useState<SearchError>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPartial, setSearchPartial] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setGmailSelections(parseStoredSelections<GmailSelection>(GMAIL_KEY));
    setDriveSelections(parseStoredSelections<DriveSelection>(DRIVE_KEY));
    setArtifacts(parseStoredArtifacts());
    setAutoSyncOnOpen(window.localStorage.getItem(AUTO_SYNC_KEY) === 'true');
    setLastSyncISO(window.localStorage.getItem(LAST_SYNC_KEY));
    setHasHydrated(true);
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

  const selectionItems = useMemo(
    () => buildSelectionItems(gmailSelections, driveSelections),
    [driveSelections, gmailSelections],
  );

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

  const handleSyncFromDrive = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncMessage(null);

    try {
      const response = await fetch('/api/timeline/artifacts/list');

      if (response.status === 401) {
        setSyncError('reconnect_required');
        return;
      }

      if (response.status === 400) {
        const payload = (await response.json()) as { error?: string };
        if (payload?.error === 'drive_not_provisioned') {
          setSyncError('drive_not_provisioned');
          return;
        }
        setSyncError('generic');
        return;
      }

      if (!response.ok) {
        setSyncError('generic');
        return;
      }

      const payload = (await response.json()) as { artifacts?: SummaryArtifact[] };
      const validArtifacts = Array.isArray(payload.artifacts)
        ? payload.artifacts.filter(isSummaryArtifact).map(normalizeArtifact)
        : [];

      if (validArtifacts.length > 0) {
        setArtifacts((prev) => persistArtifacts(validArtifacts, prev));
      }

      const now = new Date().toISOString();
      window.localStorage.setItem(LAST_SYNC_KEY, now);
      setLastSyncISO(now);
      setSyncMessage(`Synced ${validArtifacts.length} artifacts from Drive`);
    } catch {
      setSyncError('generic');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated || !autoSyncOnOpen) {
      return;
    }
    void handleSyncFromDrive();
  }, [autoSyncOnOpen, handleSyncFromDrive, hasHydrated]);

  const persistSelections = (nextGmail: GmailSelection[], nextDrive: DriveSelection[]) => {
    setGmailSelections(nextGmail);
    setDriveSelections(nextDrive);
    window.localStorage.setItem(GMAIL_KEY, JSON.stringify(nextGmail));
    window.localStorage.setItem(DRIVE_KEY, JSON.stringify(nextDrive));
  };

  const applySelectionItems = useCallback(
    (items: SelectionSetItem[], mode: 'replace' | 'merge') => {
      const nextItems = mode === 'merge' ? mergeSelectionItems(selectionItems, items) : items;
      const { gmail, drive } = selectionItemsToSelections(
        nextItems,
        gmailSelections,
        driveSelections,
      );
      persistSelections(gmail, drive);
    },
    [driveSelections, gmailSelections, selectionItems],
  );

  const fetchSelectionSets = useCallback(async () => {
    setIsLoadingSets(true);
    setSelectionError(null);
    setSelectionMessage(null);

    try {
      const response = await fetch('/api/timeline/selection/list');

      if (response.status === 401) {
        setSelectionError('reconnect_required');
        return;
      }

      if (response.status === 400) {
        const payload = (await response.json()) as { error?: string };
        if (payload?.error === 'drive_not_provisioned') {
          setSelectionError('drive_not_provisioned');
          return;
        }
        setSelectionError('generic');
        return;
      }

      if (!response.ok) {
        setSelectionError('generic');
        return;
      }

      const payload = (await response.json()) as { sets?: SelectionSetSummary[] };
      setSelectionSets(Array.isArray(payload.sets) ? payload.sets : []);
    } catch {
      setSelectionError('generic');
    } finally {
      setIsLoadingSets(false);
    }
  }, []);

  const loadSelectionSet = useCallback(
    async (fileId: string, mode?: 'replace' | 'merge') => {
      setIsPreviewLoading(true);
      setPreviewError(null);
      setSelectionMessage(null);

      try {
        const response = await fetch(`/api/timeline/selection/read?fileId=${fileId}`);

        if (response.status === 401) {
          setPreviewError('reconnect_required');
          return;
        }

        if (response.status === 400) {
          const payload = (await response.json()) as { error?: string };
          if (payload?.error === 'drive_not_provisioned') {
            setPreviewError('drive_not_provisioned');
            return;
          }
          setPreviewError('generic');
          return;
        }

        if (!response.ok) {
          setPreviewError('generic');
          return;
        }

        const payload = (await response.json()) as { set?: SelectionSet };
        if (!payload.set) {
          setPreviewError('generic');
          return;
        }

        setSelectionPreview(payload.set);
        setSelectionMessage(`Loaded set “${payload.set.name}”`);

        if (mode) {
          applySelectionItems(payload.set.items, mode);
        }
      } catch {
        setPreviewError('generic');
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [applySelectionItems],
  );

  const clearSearchState = useCallback(() => {
    setSearchResults([]);
    setSearchPartial(false);
    setSearchError(null);
  }, []);

  const runSearch = useCallback(
    async (query: string, type: SearchType) => {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }

      const controller = new AbortController();
      searchAbortRef.current = controller;
      setIsSearching(true);
      setSearchError(null);
      setSearchPartial(false);

      try {
        const response = await fetch(
          `/api/timeline/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`,
          { signal: controller.signal },
        );

        if (controller.signal.aborted) {
          return;
        }

        if (response.status === 401) {
          setSearchError('reconnect_required');
          return;
        }

        if (response.status === 400) {
          const payload = (await response.json()) as { error?: string };
          if (payload?.error === 'drive_not_provisioned') {
            setSearchError('drive_not_provisioned');
            return;
          }
          if (payload?.error === 'query_too_short') {
            setSearchError('query_too_short');
            return;
          }
          if (payload?.error === 'query_too_long') {
            setSearchError('query_too_long');
            return;
          }
          setSearchError('generic');
          return;
        }

        if (!response.ok) {
          setSearchError('generic');
          return;
        }

        const payload = (await response.json()) as {
          results?: TimelineSearchResult[];
          partial?: boolean;
        };
        setSearchResults(Array.isArray(payload.results) ? payload.results : []);
        setSearchPartial(Boolean(payload.partial));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setSearchError('generic');
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [],
  );

  const handleSearchSubmit = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        clearSearchState();
        return;
      }
      if (trimmed.length < 2) {
        setSearchError('query_too_short');
        setSearchResults([]);
        setSearchPartial(false);
        return;
      }
      if (trimmed.length > 100) {
        setSearchError('query_too_long');
        setSearchResults([]);
        setSearchPartial(false);
        return;
      }
      void runSearch(trimmed, searchType);
    },
    [clearSearchState, runSearch, searchQuery, searchType],
  );

  const handleViewSummary = useCallback(
    (fileId: string) => {
      const entry = Object.entries(artifacts).find(([, artifact]) => {
        return artifact.driveFileId === fileId;
      });
      if (!entry) {
        return;
      }
      const [key] = entry;
      setExpandedKeys((prev) => new Set(prev).add(key));
      requestAnimationFrame(() => {
        const element = document.querySelector(`[data-timeline-key="${key}"]`);
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    },
    [artifacts],
  );

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      searchAbortRef.current?.abort();
      clearSearchState();
      setIsSearching(false);
      return;
    }

    if (trimmed.length < 2) {
      searchAbortRef.current?.abort();
      setSearchError('query_too_short');
      setSearchResults([]);
      setSearchPartial(false);
      setIsSearching(false);
      return;
    }

    if (trimmed.length > 100) {
      searchAbortRef.current?.abort();
      setSearchError('query_too_long');
      setSearchResults([]);
      setSearchPartial(false);
      setIsSearching(false);
      return;
    }

    setSearchError(null);
    const handle = window.setTimeout(() => {
      void runSearch(trimmed, searchType);
    }, 350);

    return () => {
      window.clearTimeout(handle);
    };
  }, [clearSearchState, runSearch, searchQuery, searchType]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    void fetchSelectionSets();
  }, [fetchSelectionSets, hasHydrated]);

  const handleAutoSyncToggle = (checked: boolean) => {
    setAutoSyncOnOpen(checked);
    window.localStorage.setItem(AUTO_SYNC_KEY, checked ? 'true' : 'false');
  };

  const handleSaveSelectionSet = async () => {
    if (!saveName.trim()) {
      setSaveError('Enter a name for this selection set.');
      return;
    }

    if (selectionItems.length === 0) {
      setSaveError('Select Gmail or Drive items before saving.');
      return;
    }

    setSaveError(null);
    setIsSaving(true);
    setSelectionMessage(null);

    try {
      const payload = {
        name: saveName.trim(),
        notes: saveNotes.trim() || undefined,
        items: selectionItems,
        driveFileId: saveToExisting ? selectionPreview?.driveFileId : undefined,
      };

      const response = await fetch('/api/timeline/selection/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        setSelectionError('reconnect_required');
        return;
      }

      if (response.status === 400) {
        const errorPayload = (await response.json()) as { error?: string; message?: string };
        if (errorPayload?.error === 'drive_not_provisioned') {
          setSelectionError('drive_not_provisioned');
          return;
        }
        setSaveError(errorPayload?.message || 'Unable to save selection set.');
        return;
      }

      if (!response.ok) {
        setSaveError('Unable to save selection set.');
        return;
      }

      const responsePayload = (await response.json()) as { set?: SelectionSet };
      if (responsePayload.set) {
        setSelectionMessage(`Saved set “${responsePayload.set.name}”`);
        setSelectionPreview(responsePayload.set);
        setSaveOpen(false);
        setSaveName('');
        setSaveNotes('');
        setSaveToExisting(false);
        await fetchSelectionSets();
      }
    } catch {
      setSaveError('Unable to save selection set.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSaveOpen = () => {
    setSaveOpen((prev) => {
      const next = !prev;
      if (next) {
        setSaveName((current) => current || selectionPreview?.name || '');
        setSaveNotes((current) => current || selectionPreview?.notes || '');
      }
      return next;
    });
  };

  const lastSyncLabel = lastSyncISO
    ? new Date(lastSyncISO).toLocaleString()
    : 'Not synced yet';

  const previewSummary = useMemo(() => {
    if (!selectionPreview) {
      return null;
    }

    const counts = selectionPreview.items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.source] += 1;
        return acc;
      },
      { total: 0, gmail: 0, drive: 0 },
    );

    return {
      ...counts,
      updatedLabel: selectionPreview.updatedAtISO
        ? new Date(selectionPreview.updatedAtISO).toLocaleString()
        : 'Unknown update time',
    };
  }, [selectionPreview]);

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

  const syncReconnectNotice = (
    <div className={styles.notice}>
      Drive sync needs a reconnect. Please <Link href="/connect">connect your Google account</Link>.
    </div>
  );

  const syncProvisionNotice = (
    <div className={styles.notice}>
      Provision a Drive folder to sync summaries. Visit <Link href="/connect">/connect</Link>.
    </div>
  );

  const selectionReconnectNotice = (
    <div className={styles.notice}>
      Selection sets need a reconnect. Please <Link href="/connect">connect your Google account</Link>.
    </div>
  );

  const selectionProvisionNotice = (
    <div className={styles.notice}>
      Provision a Drive folder to store selection sets. Visit <Link href="/connect">/connect</Link>.
    </div>
  );

  const searchReconnectNotice = (
    <div className={styles.notice}>
      Search needs a reconnect. Please <Link href="/connect">connect your Google account</Link>.
    </div>
  );

  const searchProvisionNotice = (
    <div className={styles.notice}>
      Provision a Drive folder to search artifacts. Visit <Link href="/connect">/connect</Link>.
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
          <p className={styles.syncMeta}>Last synced: {lastSyncLabel}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.actionRow}>
            <Button
              variant="secondary"
              disabled={timelineItems.length === 0 || isSummarizing}
              onClick={handleSummarize}
            >
              {isSummarizing ? 'Generating...' : 'Generate summaries'}
            </Button>
            <Button variant="ghost" disabled={isSyncing} onClick={handleSyncFromDrive}>
              {isSyncing ? 'Syncing...' : 'Sync from Drive'}
            </Button>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={autoSyncOnOpen}
              onChange={(event) => handleAutoSyncToggle(event.target.checked)}
            />
            Auto-sync on open
          </label>
        </div>
      </div>

      <Card className={styles.searchPanel}>
        <div className={styles.searchHeader}>
          <div>
            <h2>Search summaries &amp; selection sets</h2>
            <p className={styles.muted}>
              Searches Summary.json and Selection.json artifacts stored inside your app-managed
              Drive folder.
            </p>
          </div>
        </div>
        <form className={styles.searchForm} onSubmit={handleSearchSubmit}>
          <label className={styles.field}>
            <span>Search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search summaries or selection sets"
            />
          </label>
          <div className={styles.searchRow}>
            <label className={styles.field}>
              <span>Type</span>
              <select
                className={styles.searchSelect}
                value={searchType}
                onChange={(event) => setSearchType(event.target.value as SearchType)}
              >
                <option value="all">All</option>
                <option value="summary">Summaries</option>
                <option value="selection">Selection sets</option>
              </select>
            </label>
            <div className={styles.searchButtons}>
              <Button variant="secondary" type="submit" disabled={isSearching}>
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => setSearchQuery('')}
                disabled={!searchQuery}
              >
                Clear
              </Button>
            </div>
          </div>
          {searchError === 'query_too_short' ? (
            <p className={styles.muted}>Enter at least 2 characters to search.</p>
          ) : null}
          {searchError === 'query_too_long' ? (
            <p className={styles.muted}>Search queries must be 100 characters or fewer.</p>
          ) : null}
        </form>

        {searchError === 'reconnect_required' ? searchReconnectNotice : null}
        {searchError === 'drive_not_provisioned' ? searchProvisionNotice : null}
        {searchError === 'generic' ? (
          <div className={styles.notice}>Unable to search right now. Please try again.</div>
        ) : null}
        {searchPartial ? (
          <div className={styles.notice}>
            Showing matches from a subset of files. Refine your search to see more results.
          </div>
        ) : null}

        <div className={styles.searchResults}>
          {isSearching ? <p className={styles.muted}>Searching Drive artifacts...</p> : null}
          {!isSearching && searchResults.length === 0 && searchQuery.trim().length >= 2 ? (
            <p className={styles.muted}>No matches yet. Try another keyword.</p>
          ) : null}
          {searchResults.map((result) => (
            <div key={`${result.kind}-${result.driveFileId}`} className={styles.searchResult}>
              <div className={styles.searchResultHeader}>
                <Badge tone={result.kind === 'summary' ? 'accent' : 'neutral'}>
                  {result.kind === 'summary' ? 'Summary' : 'Selection Set'}
                </Badge>
                <div>
                  <strong>{result.title}</strong>
                  {result.updatedAtISO ? (
                    <div className={styles.selectionMeta}>
                      Updated {new Date(result.updatedAtISO).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              </div>
              <p className={styles.searchSnippet}>
                {result.snippet || 'No preview available for this match.'}
              </p>
              <div className={styles.searchActions}>
                {result.kind === 'selection' ? (
                  <Button
                    variant="secondary"
                    onClick={() => loadSelectionSet(result.driveFileId, 'replace')}
                    disabled={isPreviewLoading}
                  >
                    {isPreviewLoading ? 'Loading...' : 'Load set'}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => handleViewSummary(result.driveFileId)}>
                    View in timeline
                  </Button>
                )}
                {result.driveWebViewLink ? (
                  <a
                    className={styles.driveLink}
                    href={result.driveWebViewLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Drive
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

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
      {syncError === 'reconnect_required' ? syncReconnectNotice : null}
      {syncError === 'drive_not_provisioned' ? syncProvisionNotice : null}
      {syncError === 'generic' ? (
        <div className={styles.notice}>Unable to sync from Drive. Please try again.</div>
      ) : null}
      {syncMessage ? <div className={styles.noticeSuccess}>{syncMessage}</div> : null}

      <Card className={styles.selectionPanel}>
        <div className={styles.selectionHeader}>
          <div>
            <h2>Selection sets</h2>
            <p className={styles.muted}>
              Save the current selection to Drive, or load a saved set from another device.
            </p>
          </div>
          <div className={styles.selectionActions}>
            <Button variant="secondary" onClick={toggleSaveOpen}>
              {saveOpen ? 'Close save form' : 'Save selection set'}
            </Button>
            <Button variant="ghost" onClick={fetchSelectionSets} disabled={isLoadingSets}>
              {isLoadingSets ? 'Refreshing...' : 'Refresh list'}
            </Button>
          </div>
        </div>

        {selectionError === 'reconnect_required' ? selectionReconnectNotice : null}
        {selectionError === 'drive_not_provisioned' ? selectionProvisionNotice : null}
        {selectionError === 'generic' ? (
          <div className={styles.notice}>Unable to load selection sets. Please try again.</div>
        ) : null}
        {selectionMessage ? <div className={styles.noticeSuccess}>{selectionMessage}</div> : null}

        {saveOpen ? (
          <div className={styles.selectionForm}>
            <label className={styles.field}>
              <span>Set name</span>
              <input
                type="text"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder="e.g. Q2 Launch Research"
              />
            </label>
            <label className={styles.field}>
              <span>Notes (optional)</span>
              <textarea
                value={saveNotes}
                onChange={(event) => setSaveNotes(event.target.value)}
                placeholder="Why this selection matters"
                rows={3}
              />
            </label>
            {selectionPreview?.driveFileId ? (
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={saveToExisting}
                  onChange={(event) => setSaveToExisting(event.target.checked)}
                />
                Update the loaded set in Drive
              </label>
            ) : null}
            {saveError ? <div className={styles.notice}>{saveError}</div> : null}
            <div className={styles.formActions}>
              <Button
                variant="primary"
                onClick={handleSaveSelectionSet}
                disabled={isSaving || selectionItems.length === 0}
              >
                {isSaving ? 'Saving...' : 'Save to Drive'}
              </Button>
              <span className={styles.muted}>{selectionItems.length} items in selection</span>
            </div>
          </div>
        ) : null}

        <div className={styles.selectionList}>
          {isLoadingSets ? <p className={styles.muted}>Loading selection sets...</p> : null}
          {!isLoadingSets && selectionSets.length === 0 ? (
            <p className={styles.muted}>No saved selection sets yet.</p>
          ) : null}
          {selectionSets.map((set) => (
            <div key={set.driveFileId} className={styles.selectionRow}>
              <div>
                <strong>{set.name}</strong>
                <div className={styles.selectionMeta}>
                  Updated {new Date(set.updatedAtISO).toLocaleString()}
                </div>
              </div>
              <div className={styles.selectionButtons}>
                <Button
                  variant="ghost"
                  onClick={() => loadSelectionSet(set.driveFileId)}
                  disabled={isPreviewLoading}
                >
                  {isPreviewLoading ? 'Loading...' : 'Load'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => loadSelectionSet(set.driveFileId, 'replace')}
                  disabled={isPreviewLoading}
                >
                  Replace selection
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => loadSelectionSet(set.driveFileId, 'merge')}
                  disabled={isPreviewLoading}
                >
                  Merge into selection
                </Button>
                {set.driveWebViewLink ? (
                  <a
                    className={styles.driveLink}
                    href={set.driveWebViewLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Drive
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {previewError === 'reconnect_required' ? selectionReconnectNotice : null}
        {previewError === 'drive_not_provisioned' ? selectionProvisionNotice : null}
        {previewError === 'generic' ? (
          <div className={styles.notice}>Unable to load that selection set.</div>
        ) : null}

        {selectionPreview && previewSummary ? (
          <div className={styles.selectionPreview}>
            <div>
              <h3>{selectionPreview.name}</h3>
              <p className={styles.muted}>
                {previewSummary.total} items ({previewSummary.gmail} Gmail, {previewSummary.drive}{' '}
                Drive)
              </p>
              <p className={styles.muted}>Updated {previewSummary.updatedLabel}</p>
              {selectionPreview.notes ? <p>{selectionPreview.notes}</p> : null}
            </div>
            <div className={styles.selectionButtons}>
              <Button
                variant="secondary"
                onClick={() => applySelectionItems(selectionPreview.items, 'replace')}
              >
                Replace selection
              </Button>
              <Button
                variant="secondary"
                onClick={() => applySelectionItems(selectionPreview.items, 'merge')}
              >
                Merge into selection
              </Button>
              {selectionPreview.driveWebViewLink ? (
                <a
                  className={styles.driveLink}
                  href={selectionPreview.driveWebViewLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Drive
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

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
            const sourceMetadata = artifact?.sourceMetadata;
            const fromLabel =
              item.kind === 'gmail' ? sourceMetadata?.from ?? item.subtitle ?? undefined : undefined;
            const subjectLabel =
              item.kind === 'gmail' ? sourceMetadata?.subject ?? item.title ?? undefined : undefined;
            const mimeTypeLabel =
              item.kind === 'drive' ? sourceMetadata?.mimeType ?? item.subtitle ?? undefined : undefined;
            const modifiedLabel =
              item.kind === 'drive'
                ? sourceMetadata?.driveModifiedTime ?? item.timestamp ?? undefined
                : undefined;

            return (
              <Card
                key={`${item.kind}-${item.id}`}
                className={styles.item}
                data-timeline-key={key}
              >
                <div className={styles.itemContent}>
                  <div className={styles.itemHeader}>
                    <h3>{item.title}</h3>
                    <Badge tone={hasSummary ? 'success' : 'warning'}>
                      {hasSummary ? 'Summarized' : 'Pending'}
                    </Badge>
                  </div>
                  <p className={styles.subtitle}>{item.subtitle}</p>
                  <p className={styles.timestamp}>{item.timestamp ?? '—'}</p>
                  {(fromLabel || subjectLabel || mimeTypeLabel || modifiedLabel) && (
                    <div className={styles.metadata}>
                      {fromLabel ? (
                        <div className={styles.metaRow}>
                          <span className={styles.metaLabel}>From</span>
                          <span>{fromLabel}</span>
                        </div>
                      ) : null}
                      {subjectLabel ? (
                        <div className={styles.metaRow}>
                          <span className={styles.metaLabel}>Subject</span>
                          <span>{subjectLabel}</span>
                        </div>
                      ) : null}
                      {mimeTypeLabel ? (
                        <div className={styles.metaRow}>
                          <span className={styles.metaLabel}>MIME type</span>
                          <span>{mimeTypeLabel}</span>
                        </div>
                      ) : null}
                      {modifiedLabel ? (
                        <div className={styles.metaRow}>
                          <span className={styles.metaLabel}>Modified</span>
                          <span>{modifiedLabel}</span>
                        </div>
                      ) : null}
                    </div>
                  )}
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
                      {artifact?.sourcePreview ? (
                        <details className={styles.preview}>
                          <summary>Content preview</summary>
                          <div className={styles.previewContent}>
                            <p>{artifact.sourcePreview}</p>
                            {artifact.sourceMetadata?.driveWebViewLink ? (
                              <a
                                className={styles.driveLink}
                                href={artifact.sourceMetadata.driveWebViewLink}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open source file
                              </a>
                            ) : null}
                          </div>
                        </details>
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
