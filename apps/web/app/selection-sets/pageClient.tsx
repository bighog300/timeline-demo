'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { parseApiError } from '../lib/apiErrors';
import styles from './selectionSets.module.css';

type SelectionSetMetadata = {
  id: string;
  title: string;
  updatedAt: string;
  kind: 'gmail_selection_set' | 'drive_selection_set';
  source: 'gmail' | 'drive';
};

type SelectionSet = SelectionSetMetadata & {
  version: 1;
  createdAt: string;
  query: { q: string };
};

type RunSummary = {
  id: string;
  action: 'run' | 'summarize';
  status: 'success' | 'partial_success' | 'failed';
  selectionSet: { id: string; title: string; source: 'gmail' | 'drive'; kind: SelectionSet['kind']; query: { q: string } };
  startedAt: string;
  finishedAt: string | null;
  counts: {
    foundCount: number;
    processedCount: number;
    failedCount: number;
  };
  requestIds: string[];
  artifact: Record<string, unknown>;
};

type GmailResult = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  internalDate: string;
};

type DriveResult = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
};

const MAX_SUMMARY_PAGES = 5;
const MAX_SUMMARY_ITEMS = 50;
const SUMMARY_BATCH_SIZE = 10;
const MAX_SELECTION_ITEMS = 500;

const gmailStorageKey = 'timeline.gmailSelections';
const driveStorageKey = 'timeline.driveSelections';

const formatRelative = (iso: string) => {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ${minutes >= 0 ? 'ago' : 'from now'}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ${hours >= 0 ? 'ago' : 'from now'}`;
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ${days >= 0 ? 'ago' : 'from now'}`;
};

const parseStored = (key: string): Array<Record<string, unknown>> => {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export default function SelectionSetsPageClient({ isConfigured }: { isConfigured: boolean }) {
  const [sets, setSets] = React.useState<SelectionSetMetadata[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'updated_desc' | 'title_asc'>('updated_desc');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [resultsSet, setResultsSet] = useState<SelectionSetMetadata | null>(null);
  const [results, setResults] = useState<Array<GmailResult | DriveResult>>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentQuery, setCurrentQuery] = useState<string | null>(null);

  const [confirmSummarize, setConfirmSummarize] = useState<SelectionSetMetadata | null>(null);
  const [summarizeStatus, setSummarizeStatus] = useState<string | null>(null);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [summarizeDone, setSummarizeDone] = useState<{ total: number; failed: number } | null>(null);

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runDetails, setRunDetails] = useState<RunSummary | null>(null);

  const loadRuns = React.useCallback(async () => {
    setRunsLoading(true);
    const response = await fetch('/api/runs?limit=10');
    const payload = (await response.json()) as { runs?: RunSummary[] };
    if (response.ok) {
      setRecentRuns(payload.runs ?? []);
    }
    setRunsLoading(false);
  }, []);

  const loadSets = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch('/api/selection-sets');
    const payload = (await response.json()) as { sets?: SelectionSetMetadata[]; error?: { code?: string; message?: string } };

    if (!response.ok) {
      setLoading(false);
      setError(payload.error?.code === 'reconnect_required' ? 'Reconnect required.' : payload.error?.message ?? 'Failed to load sets.');
      return;
    }

    setSets(payload.sets ?? []);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (!isConfigured) {
      return;
    }

    void loadSets();
    void loadRuns();
  }, [isConfigured, loadRuns, loadSets]);

  const createRunArtifact = async ({
    set,
    action,
    caps,
  }: {
    set: SelectionSet;
    action: 'run' | 'summarize';
    caps: { maxPages: number; maxItems: number; pageSize: number; batchSize: number };
  }) => {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectionSet: set, action, caps }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { runId?: string };
    return payload.runId ?? null;
  };

  const patchRunArtifact = async (runId: string, patch: Record<string, unknown>) => {
    await fetch(`/api/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadRuns();
  };

  const visibleSets = useMemo(() => {
    const filtered = sets.filter((set) => set.title.toLowerCase().includes(filter.toLowerCase()));
    if (sort === 'title_asc') {
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    }

    return [...filtered].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [filter, sets, sort]);

  const grouped = useMemo(
    () => ({
      gmail: visibleSets.filter((set) => set.source === 'gmail'),
      drive: visibleSets.filter((set) => set.source === 'drive'),
    }),
    [visibleSets],
  );

  const loadSetById = async (id: string): Promise<SelectionSet | null> => {
    const response = await fetch(`/api/selection-sets/${id}`);
    const payload = (await response.json()) as { set?: SelectionSet; error?: { code?: string; message?: string } };

    if (!response.ok || !payload.set) {
      setRunError(payload.error?.code === 'reconnect_required' ? 'Reconnect required.' : payload.error?.message ?? 'Failed to load selection set.');
      return null;
    }

    return payload.set;
  };

  const runSearch = async ({ set, pageToken }: { set: SelectionSetMetadata; pageToken: string | null }) => {
    setBusyId(set.id);
    setRunError(null);
    const fullSet = await loadSetById(set.id);
    if (!fullSet) {
      setBusyId(null);
      return;
    }

    const endpoint = set.source === 'gmail' ? '/api/google/gmail/search' : '/api/google/drive/search';
    const runId = await createRunArtifact({
      set: fullSet,
      action: 'run',
      caps: { maxPages: 1, maxItems: 50, pageSize: 50, batchSize: 0 },
    });
    const body = set.source === 'gmail' ? { q: fullSet.query.q, maxResults: 50, pageToken } : { q: fullSet.query.q, pageSize: 50, pageToken };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      code?: string;
      message?: string;
      messages?: GmailResult[];
      files?: DriveResult[];
      nextPageToken?: string | null;
      requestId?: string;
    };

    if (!response.ok) {
      if (runId) {
        await patchRunArtifact(runId, {
          finishedAt: new Date().toISOString(),
          result: {
            status: 'failed',
            foundCount: 0,
            processedCount: 0,
            failedCount: 0,
            requestIds: payload.requestId ? [payload.requestId] : [],
            note: payload.message ?? 'Run failed.',
          },
        });
      }
      setRunError(payload.code === 'reconnect_required' ? 'Reconnect required.' : payload.message ?? 'Run failed.');
      setBusyId(null);
      return;
    }

    if (runId) {
      const foundCount = ((set.source === 'gmail' ? payload.messages : payload.files) ?? []).length;
      await patchRunArtifact(runId, {
        finishedAt: new Date().toISOString(),
        result: {
          status: 'success',
          foundCount,
          processedCount: 0,
          failedCount: 0,
          requestIds: [],
          note: null,
        },
      });
    }

    setResultsSet(set);
    setCurrentQuery(fullSet.query.q);
    setResults((set.source === 'gmail' ? payload.messages : payload.files) ?? []);
    setNextPageToken(payload.nextPageToken ?? null);
    setSelectedIds([]);
    setBusyId(null);
  };

  const addSelectedToTimeline = () => {
    if (!resultsSet) {
      return;
    }

    const source = resultsSet.source;
    const key = source === 'gmail' ? gmailStorageKey : driveStorageKey;
    const existing = parseStored(key);
    const merged = new Map<string, Record<string, unknown>>();

    for (const item of existing) {
      const id = typeof item.id === 'string' ? item.id : '';
      if (id) merged.set(id, item);
    }

    for (const item of results) {
      if (!selectedIds.includes(item.id)) continue;
      if (source === 'gmail') {
        const gmail = item as GmailResult;
        merged.set(gmail.id, {
          id: gmail.id,
          threadId: gmail.threadId,
          subject: gmail.subject,
          from: gmail.from,
          internalDate: gmail.internalDate,
        });
      } else {
        const drive = item as DriveResult;
        merged.set(drive.id, {
          id: drive.id,
          name: drive.name,
          mimeType: drive.mimeType,
          modifiedTime: drive.modifiedTime,
        });
      }
    }

    window.localStorage.setItem(key, JSON.stringify(Array.from(merged.values()).slice(0, MAX_SELECTION_ITEMS)));
  };

  const summarize = async (set: SelectionSetMetadata) => {
    setBusyId(set.id);
    setSummarizeStatus('Collecting items (page 1)...');
    setSummarizeError(null);
    setSummarizeDone(null);

    const fullSet = await loadSetById(set.id);
    if (!fullSet) {
      setBusyId(null);
      return;
    }

    const endpoint = set.source === 'gmail' ? '/api/google/gmail/search' : '/api/google/drive/search';
    const ids: string[] = [];
    let pageToken: string | null = null;
    const requestIds: string[] = [];
    const runId = await createRunArtifact({
      set: fullSet,
      action: 'summarize',
      caps: { maxPages: MAX_SUMMARY_PAGES, maxItems: MAX_SUMMARY_ITEMS, pageSize: 50, batchSize: SUMMARY_BATCH_SIZE },
    });

    for (let page = 1; page <= MAX_SUMMARY_PAGES && ids.length < MAX_SUMMARY_ITEMS; page += 1) {
      setSummarizeStatus(`Collecting items (page ${page}/${MAX_SUMMARY_PAGES})...`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          set.source === 'gmail'
            ? { q: fullSet.query.q, maxResults: 50, pageToken }
            : { q: fullSet.query.q, pageSize: 50, pageToken },
        ),
      });
      const payload = (await response.json()) as {
        code?: string;
        message?: string;
        requestId?: string;
        messages?: GmailResult[];
        files?: DriveResult[];
        nextPageToken?: string | null;
      };

      if (!response.ok) {
        if (payload.requestId) {
          requestIds.push(payload.requestId);
        }
        if (runId) {
          await patchRunArtifact(runId, {
            finishedAt: new Date().toISOString(),
            result: {
              status: 'failed',
              foundCount: ids.length,
              processedCount: 0,
              failedCount: 0,
              requestIds,
              note: payload.message ?? 'Failed while collecting items.',
            },
            items: { ids: null, idsIncluded: false },
          });
        }
        if (payload.code === 'reconnect_required') {
          setSummarizeError('Reconnect required.');
        } else if (response.status === 429 || payload.code === 'rate_limited') {
          setSummarizeError('Rate limited. Please retry in a moment.');
        } else if (response.status >= 500) {
          setSummarizeError(`Server error. Request ID: ${payload.requestId ?? 'n/a'}`);
        } else {
          setSummarizeError(payload.message ?? 'Failed while collecting items.');
        }
        setBusyId(null);
        return;
      }

      const pageIds = ((set.source === 'gmail' ? payload.messages : payload.files) ?? []).map((item) => item.id);
      ids.push(...pageIds);
      pageToken = payload.nextPageToken ?? null;
      if (!pageToken) {
        break;
      }
    }

    const capped = ids.slice(0, MAX_SUMMARY_ITEMS);
    if (capped.length === 0) {
      setSummarizeStatus(null);
      setSummarizeError('No items found for this saved search.');
      setBusyId(null);
      return;
    }

    let success = 0;
    let failed = 0;
    for (let offset = 0; offset < capped.length; offset += SUMMARY_BATCH_SIZE) {
      const chunk = capped.slice(offset, offset + SUMMARY_BATCH_SIZE);
      setSummarizeStatus(`Summarizing ${Math.min(offset + chunk.length, capped.length)}/${capped.length}...`);
      const response = await fetch('/api/timeline/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: chunk.map((id) => ({ source: set.source, id })) }),
      });

      if (!response.ok) {
        const apiError = await parseApiError(response);
        if (apiError?.requestId) {
          requestIds.push(apiError.requestId);
        }
        if (apiError?.code === 'reconnect_required') {
          setSummarizeError('Reconnect required.');
        } else if (response.status === 429 || apiError?.code === 'rate_limited') {
          setSummarizeError('Rate limited. Please retry in a moment.');
        } else if (response.status >= 500) {
          setSummarizeError(`Server error. Request ID: ${apiError?.requestId ?? 'n/a'}`);
        } else {
          setSummarizeError(apiError?.message ?? 'Summarize failed.');
        }
        failed += chunk.length;
        continue;
      }

      const payload = (await response.json()) as { artifacts?: unknown[]; failed?: unknown[] };
      success += payload.artifacts?.length ?? 0;
      failed += payload.failed?.length ?? 0;
    }

    setSummarizeStatus(null);
    setSummarizeDone({ total: success, failed });
    setConfirmSummarize(null);
    setBusyId(null);
    if (runId) {
      await patchRunArtifact(runId, {
        finishedAt: new Date().toISOString(),
        result: {
          status: failed > 0 ? (success > 0 ? 'partial_success' : 'failed') : 'success',
          foundCount: capped.length,
          processedCount: success,
          failedCount: failed,
          requestIds,
          note: failed > 0 ? 'One or more summarize batches failed.' : null,
        },
        items: { ids: null, idsIncluded: false },
      });
    }
  };

  const statusTone = (status: RunSummary['status']): 'success' | 'accent' | 'warning' => {
    if (status === 'success') {
      return 'success';
    }

    return status === 'partial_success' ? 'accent' : 'warning';
  };

  const saveRename = async (id: string) => {
    setBusyId(id);
    const response = await fetch(`/api/selection-sets/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: renameTitle }),
    });

    const payload = (await response.json()) as { title?: string; updatedAt?: string; error?: { message?: string } };
    if (!response.ok) {
      setError(payload.error?.message ?? 'Rename failed.');
      setBusyId(null);
      return;
    }

    setSets((prev) => prev.map((set) => (set.id === id ? { ...set, title: payload.title ?? set.title, updatedAt: payload.updatedAt ?? set.updatedAt } : set)));
    setRenameId(null);
    setRenameTitle('');
    setBusyId(null);
  };

  const confirmDelete = async (id: string) => {
    setBusyId(id);
    const response = await fetch(`/api/selection-sets/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Delete failed.');
      setBusyId(null);
      return;
    }

    setSets((prev) => prev.filter((set) => set.id !== id));
    setDeleteId(null);
    setDeleteConfirm('');
    setBusyId(null);
  };

  const renderGroup = (title: string, items: SelectionSetMetadata[]) => (
    <section className={styles.group}>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className={styles.empty}>No selection sets.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((set) => (
            <li key={set.id} className={styles.item}>
              <div className={styles.main}>
                {renameId === set.id ? (
                  <div className={styles.renameRow}>
                    <input value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} aria-label={`Rename ${set.title}`} />
                    <Button onClick={() => void saveRename(set.id)} disabled={busyId === set.id}>Save</Button>
                    <Button variant="secondary" onClick={() => setRenameId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <>
                    <strong>{set.title}</strong>
                    <div className={styles.meta}>
                      <Badge tone={set.source === 'gmail' ? 'accent' : 'neutral'}>{set.source === 'gmail' ? 'Gmail' : 'Drive'}</Badge>
                      <time title={new Date(set.updatedAt).toISOString()}>Updated {formatRelative(set.updatedAt)}</time>
                    </div>
                  </>
                )}
              </div>

              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => void runSearch({ set, pageToken: null })} disabled={busyId === set.id}>Run</Button>
                <Button variant="secondary" onClick={() => setConfirmSummarize(set)} disabled={busyId === set.id}>Summarize</Button>
                <Button variant="ghost" onClick={() => { setRenameId(set.id); setRenameTitle(set.title); }} disabled={busyId === set.id}>Rename</Button>
                <Button variant="ghost" onClick={() => setDeleteId(set.id)} disabled={busyId === set.id}>Delete</Button>
              </div>

              {deleteId === set.id ? (
                <div className={styles.confirmBox}>
                  <p>Type DELETE to remove this selection set artifact.</p>
                  <input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} aria-label={`Confirm delete ${set.title}`} />
                  <div className={styles.actions}>
                    <Button onClick={() => void confirmDelete(set.id)} disabled={deleteConfirm !== 'DELETE' || busyId === set.id}>Confirm delete</Button>
                    <Button variant="secondary" onClick={() => { setDeleteId(null); setDeleteConfirm(''); }}>Cancel</Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Selection Sets Dashboard</h1>
        <p className={styles.muted}>Drive-backed saved searches for Gmail and Drive.</p>
      </header>

      {!isConfigured ? <p className={styles.error}>Google auth is not configured.</p> : null}
      {loading ? <p>Loading selection sets…</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.controls}>
        <input placeholder="Filter by title" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <select value={sort} onChange={(event) => setSort(event.target.value as 'updated_desc' | 'title_asc')}>
          <option value="updated_desc">Updated desc</option>
          <option value="title_asc">Title asc</option>
        </select>
      </section>

      {renderGroup('Gmail saved searches', grouped.gmail)}
      {renderGroup('Drive saved searches', grouped.drive)}

      <section className={styles.group}>
        <h2>Recent runs</h2>
        {runsLoading ? <p className={styles.muted}>Loading recent runs…</p> : null}
        {recentRuns.length === 0 ? (
          <p className={styles.empty}>No run artifacts yet.</p>
        ) : (
          <ul className={styles.list}>
            {recentRuns.map((run) => (
              <li key={run.id} className={styles.item}>
                <div className={styles.main}>
                  <strong>{run.selectionSet.title}</strong>
                  <div className={styles.meta}>
                    <Badge tone={run.action === 'run' ? 'neutral' : 'accent'}>{run.action === 'run' ? 'Run' : 'Summarize'}</Badge>
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    <time title={(run.finishedAt ?? run.startedAt)}>{formatRelative(run.finishedAt ?? run.startedAt)}</time>
                  </div>
                </div>
                <p className={styles.muted}>
                  Found: {run.counts.foundCount} • Processed: {run.counts.processedCount} • Failed: {run.counts.failedCount}
                </p>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={() => setRunDetails(run)}>View details</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {runDetails ? (
        <section className={styles.confirmBox}>
          <h3>Run details</h3>
          <pre className={styles.runJson}>{JSON.stringify(runDetails.artifact, null, 2)}</pre>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setRunDetails(null)}>Close</Button>
          </div>
        </section>
      ) : null}

      {confirmSummarize ? (
        <section className={styles.confirmBox}>
          <h3>Summarize saved search: {confirmSummarize.title}</h3>
          <p>Caps: Up to 5 pages / 50 items.</p>
          <p className={styles.warn}>This will create Drive-backed summary artifacts in Timeline.</p>
          <div className={styles.actions}>
            <Button onClick={() => void summarize(confirmSummarize)} disabled={busyId === confirmSummarize.id}>Confirm summarize</Button>
            <Button variant="secondary" onClick={() => setConfirmSummarize(null)}>Cancel</Button>
          </div>
        </section>
      ) : null}

      {summarizeStatus ? <p className={styles.notice}>{summarizeStatus}</p> : null}
      {summarizeError ? <p className={styles.error}>{summarizeError}</p> : null}
      {summarizeDone ? (
        <p className={styles.notice}>
          {summarizeDone.failed > 0 ? `Partial success: ${summarizeDone.total} summarized, ${summarizeDone.failed} failed.` : `Success: ${summarizeDone.total} summarized.`}{' '}
          <Link href="/timeline">Open Timeline</Link>
        </p>
      ) : null}

      {resultsSet ? (
        <section className={styles.results}>
          <h3>Results for: {resultsSet.title}</h3>
          <p className={styles.muted}>{resultsSet.source.toUpperCase()} query: {currentQuery}</p>
          {runError ? <p className={styles.error}>{runError}</p> : null}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setSelectedIds(results.map((item) => item.id))}>Select all (page)</Button>
            <Button variant="secondary" onClick={() => setSelectedIds([])}>Clear selection</Button>
            <Button onClick={addSelectedToTimeline}>Add all (page) to Timeline selection</Button>
            {nextPageToken ? <Button variant="secondary" onClick={() => void runSearch({ set: resultsSet, pageToken: nextPageToken })}>Next page</Button> : null}
          </div>

          <ul className={styles.list}>
            {results.map((item) => (
              <li key={item.id} className={styles.item}>
                <label className={styles.resultRow}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={(event) => {
                      setSelectedIds((prev) =>
                        event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                      );
                    }}
                  />
                  <span>{'subject' in item ? item.subject : item.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
