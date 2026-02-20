'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { parseApiError } from '../lib/apiErrors';
import styles from './runsPanel.module.css';

type RunsPanelProps = {
  fromSelect: boolean;
  selectionSetId: string | null;
  runId: string | null;
};

type RunStatusLabel = 'pending' | 'running' | 'succeeded' | 'failed';

type RunRecord = {
  id: string;
  action: 'run' | 'summarize';
  status: 'success' | 'partial_success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  selectionSet?: {
    id: string;
    title: string;
  };
  artifact?: {
    result?: {
      note?: string | null;
    };
  };
};

type RunsResponse = {
  runs?: RunRecord[];
};

const RUN_LIMIT = 15;
const RUNNING_REFRESH_INTERVAL_MS = 10_000;

const summarizeStatus = (run: RunRecord): RunStatusLabel => {
  if (!run.finishedAt) {
    return 'running';
  }
  if (run.status === 'failed') {
    return 'failed';
  }
  return 'succeeded';
};

const badgeToneForStatus = (status: RunStatusLabel) => {
  if (status === 'running' || status === 'pending') {
    return 'warning' as const;
  }
  if (status === 'succeeded') {
    return 'success' as const;
  }
  return 'neutral' as const;
};

const prettyStatus = (status: RunStatusLabel) => status[0].toUpperCase() + status.slice(1);

const firstLine = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const line = value.split('\n')[0]?.trim();
  return line || null;
};

export default function RunsPanel({ fromSelect, selectionSetId, runId }: RunsPanelProps) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSummarizingMissing, setIsSummarizingMissing] = useState(false);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [lastUpdatedISO, setLastUpdatedISO] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/runs?limit=${RUN_LIMIT}`);
      if (!response.ok) {
        if (response.status === 401) {
          setIsAuthError(true);
          setErrorMessage('Sign in required');
          return;
        }
        if (response.status === 403) {
          setIsAuthError(true);
          setErrorMessage('Access denied');
          return;
        }
        setIsAuthError(false);
        setErrorMessage('Unable to load progress. Try refresh.');
        return;
      }

      const payload = (await response.json()) as RunsResponse;
      const nextRuns = Array.isArray(payload.runs) ? payload.runs : [];
      nextRuns.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
      setRuns(nextRuns);
      setLastUpdatedISO(new Date().toISOString());
      setIsAuthError(false);
    } catch {
      setIsAuthError(false);
      setErrorMessage('Unable to load progress. Try refresh.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    if (fromSelect || selectionSetId || runId) {
      void refreshRuns();
    }
  }, [fromSelect, refreshRuns, runId, selectionSetId]);

  const hasRunning = useMemo(
    () => runs.some((run) => summarizeStatus(run) === 'running' || summarizeStatus(run) === 'pending'),
    [runs],
  );

  useEffect(() => {
    if (!hasRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRuns();
    }, RUNNING_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasRunning, refreshRuns]);

  const counts = useMemo(() => {
    let running = 0;
    let failed = 0;
    let completed = 0;

    runs.forEach((run) => {
      const status = summarizeStatus(run);
      if (status === 'running' || status === 'pending') {
        running += 1;
      } else if (status === 'failed') {
        failed += 1;
      } else {
        completed += 1;
      }
    });

    return { running, failed, completed };
  }, [runs]);

  const summarizeMissing = async (setId: string) => {
    setIsSummarizingMissing(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const response = await fetch('/api/timeline/summarize-missing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectionSetId: setId }),
      });
      if (!response.ok) {
        const apiError = await parseApiError(response);
        setErrorMessage(apiError?.message ?? 'Unable to start backfill.');
        return;
      }

      setMessage('Backfill started.');
      await refreshRuns();
    } catch {
      setErrorMessage('Unable to start backfill.');
    } finally {
      setIsSummarizingMissing(false);
    }
  };

  const retryRun = async (run: RunRecord) => {
    if (!run.selectionSet?.id) {
      return;
    }

    setRetryingRunId(run.id);
    setErrorMessage(null);
    setMessage(null);

    try {
      const retryResponse = await fetch(`/api/runs/${encodeURIComponent(run.id)}/retry`, {
        method: 'POST',
      });

      if (retryResponse.ok) {
        setMessage('Retry started.');
        await refreshRuns();
        return;
      }

      if (retryResponse.status !== 404) {
        const retryError = await parseApiError(retryResponse);
        setErrorMessage(retryError?.message ?? 'Unable to retry run.');
        return;
      }

      const response = await fetch('/api/timeline/summarize-missing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectionSetId: run.selectionSet.id }),
      });

      if (!response.ok) {
        const apiError = await parseApiError(response);
        setErrorMessage(apiError?.message ?? 'Retry requires re-selecting documents.');
        return;
      }

      setMessage('Retry started.');
      await refreshRuns();
    } catch {
      setErrorMessage('Unable to retry run.');
    } finally {
      setRetryingRunId(null);
    }
  };

  const retryAllFailed = async () => {
    const failedRuns = runs.filter((run) => summarizeStatus(run) === 'failed');
    const withSelectionSet = failedRuns.find((run) => Boolean(run.selectionSet?.id));
    if (!withSelectionSet?.selectionSet?.id) {
      setErrorMessage('Retry requires re-selecting documents.');
      return;
    }

    await summarizeMissing(withSelectionSet.selectionSet.id);
  };

  return (
    <Card className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2>Progress</h2>
          <p className={styles.summary}>
            Running: {counts.running} • Failed: {counts.failed} • Completed: {counts.completed}
          </p>
          <p className={styles.meta}>
            Last updated: {lastUpdatedISO ? new Date(lastUpdatedISO).toLocaleString() : 'Not yet'}
          </p>
          {selectionSetId ? (
            <p className={styles.meta}>
              Selection set:{' '}
              <Link href={`/timeline?selectionSetId=${encodeURIComponent(selectionSetId)}`}>{selectionSetId}</Link>
            </p>
          ) : null}
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => void refreshRuns()} disabled={isLoading || isAuthError}>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void retryAllFailed()}
            disabled={isAuthError || runs.every((run) => summarizeStatus(run) !== 'failed')}
          >
            Retry failed
          </Button>
          <Button
            variant="secondary"
            disabled={isSummarizingMissing || isAuthError || !selectionSetId}
            onClick={() => selectionSetId && void summarizeMissing(selectionSetId)}
            title={selectionSetId ? undefined : 'Requires selectionSetId in URL'}
          >
            {isSummarizingMissing ? 'Starting...' : 'Summarize missing'}
          </Button>
        </div>
      </div>

      {fromSelect ? <div className={styles.notice}>Summarization started — check progress below.</div> : null}
      {errorMessage ? <div className={styles.error}>{errorMessage}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      {runs.length === 0 ? (
        <div className={styles.empty}>
          <p>No runs yet. Start by summarizing documents.</p>
          <Link href="/select/drive">Go to Drive selection</Link>
        </div>
      ) : (
        <ul className={styles.runList}>
          {runs.map((run) => {
            const status = summarizeStatus(run);
            const errorSnippet = status === 'failed' ? firstLine(run.artifact?.result?.note) : null;
            return (
              <li key={run.id} className={styles.runItem}>
                <div className={styles.runMain}>
                  <Badge tone={badgeToneForStatus(status)}>{prettyStatus(status)}</Badge>
                  <strong>{run.action === 'summarize' ? 'Summarize selection' : 'Run selection'}</strong>
                  <span className={styles.meta}>
                    Updated {new Date(run.finishedAt ?? run.startedAt).toLocaleString()}
                  </span>
                </div>
                {run.selectionSet?.title ? <p className={styles.meta}>{run.selectionSet.title}</p> : null}
                {errorSnippet ? <p className={styles.errorSnippet}>{errorSnippet}</p> : null}
                <div className={styles.rowActions}>
                  {status === 'failed' ? (
                    <Button
                      variant="ghost"
                      disabled={retryingRunId === run.id || !run.selectionSet?.id}
                      onClick={() => void retryRun(run)}
                    >
                      {retryingRunId === run.id ? 'Retrying...' : 'Retry'}
                    </Button>
                  ) : null}
                  {!run.selectionSet?.id && status === 'failed' ? (
                    <span className={styles.meta}>
                      Retry requires re-selecting documents. <Link href="/select/drive">Re-select</Link>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
