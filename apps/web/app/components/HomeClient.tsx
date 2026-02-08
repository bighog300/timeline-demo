'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Button from './ui/Button';
import Card from './ui/Card';
import Skeleton from './ui/Skeleton';
import { parseApiError } from '../lib/apiErrors';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import type { CalendarEntry, SummaryArtifact } from '../lib/types';
import { isCalendarEntry, normalizeCalendarEntry } from '../lib/validateCalendarEntry';
import { isSummaryArtifact, normalizeArtifact } from '../lib/validateArtifact';
import styles from '../page.module.css';

type MetricStatus = 'loading' | 'ready' | 'needs-connect' | 'error';

type CalendarResponse = {
  entries?: CalendarEntry[];
};

type TimelineArtifactsResponse = {
  artifacts?: SummaryArtifact[];
};

type MetricState = {
  count: number;
  status: MetricStatus;
  message?: string;
};

const LAST_SYNC_KEY = 'timeline.lastSyncISO';

const syncFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatSyncLabel = (value: string | null) => {
  if (!value) {
    return 'Not yet synced';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return 'Not yet synced';
  }
  return syncFormatter.format(parsed);
};

export default function HomeClient() {
  const [calendarMetric, setCalendarMetric] = useState<MetricState>({
    count: 0,
    status: 'loading',
  });
  const [timelineMetric, setTimelineMetric] = useState<MetricState>({
    count: 0,
    status: 'loading',
  });
  const [lastSyncISO, setLastSyncISO] = useState<string | null>(null);
  const showConnectCta =
    calendarMetric.status === 'needs-connect' || timelineMetric.status === 'needs-connect';

  const lastSyncLabel = useMemo(() => formatSyncLabel(lastSyncISO), [lastSyncISO]);

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    setCalendarMetric((prev) => ({ ...prev, status: 'loading', message: undefined }));
    setTimelineMetric((prev) => ({ ...prev, status: 'loading', message: undefined }));

    try {
      const [calendarResponse, timelineResponse] = await Promise.all([
        fetchWithTimeout('/api/calendar/entries', { signal }),
        fetchWithTimeout('/api/timeline/artifacts/list', { signal }),
      ]);

      if (calendarResponse.ok) {
        const calendarData = (await calendarResponse.json()) as CalendarResponse;
        const entries = Array.isArray(calendarData.entries)
          ? calendarData.entries.filter(isCalendarEntry).map(normalizeCalendarEntry)
          : [];
        setCalendarMetric({ count: entries.length, status: 'ready' });
      } else if (calendarResponse.status === 401 || calendarResponse.status === 503) {
        setCalendarMetric({ count: 0, status: 'needs-connect' });
      } else {
        const apiError = await parseApiError(calendarResponse);
        setCalendarMetric({
          count: 0,
          status: 'error',
          message: apiError?.message ?? 'Unable to load calendar entries.',
        });
      }

      if (timelineResponse.ok) {
        const timelineData = (await timelineResponse.json()) as TimelineArtifactsResponse;
        const artifacts = Array.isArray(timelineData.artifacts)
          ? timelineData.artifacts.filter(isSummaryArtifact).map(normalizeArtifact)
          : [];
        setTimelineMetric({ count: artifacts.length, status: 'ready' });
      } else if (timelineResponse.status === 401 || timelineResponse.status === 503) {
        setTimelineMetric({ count: 0, status: 'needs-connect' });
      } else {
        const apiError = await parseApiError(timelineResponse);
        setTimelineMetric({
          count: 0,
          status: 'error',
          message: apiError?.message ?? 'Unable to load timeline summaries.',
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setCalendarMetric({
        count: 0,
        status: 'error',
        message: 'Unable to load summary data. Please try again.',
      });
      setTimelineMetric({
        count: 0,
        status: 'error',
        message: 'Unable to load summary data. Please try again.',
      });
    } finally {
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSummary(controller.signal);
    return () => controller.abort();
  }, [loadSummary]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    setLastSyncISO(window.localStorage.getItem(LAST_SYNC_KEY));
  }, []);

  return (
    <div className={styles.summaryGrid}>
      <Card>
        <h2>Overview</h2>
        <p>
          Connect your accounts, select Gmail or Drive content, and explore the Timeline and Calendar
          views. Summaries are stored as Drive-backed artifacts so the experience stays portable.
        </p>
        {showConnectCta ? (
          <Button type="button" onClick={() => window.location.assign('/connect')}>
            Connect to get started
          </Button>
        ) : null}
      </Card>
      <Card>
        <h2>Calendar entries</h2>
        {calendarMetric.status === 'loading' ? (
          <Skeleton height="24px" width="80px" />
        ) : calendarMetric.status === 'needs-connect' ? (
          <p className={styles.metricValue}>Connect to view</p>
        ) : calendarMetric.status === 'error' ? (
          <div className={styles.inlineError}>
            <p>{calendarMetric.message}</p>
            <Button type="button" variant="secondary" onClick={() => loadSummary()}>
              Retry
            </Button>
          </div>
        ) : (
          <p className={styles.metricValue}>{calendarMetric.count}</p>
        )}
        <p className={styles.metricLabel}>Scheduled sessions from your connected calendar.</p>
      </Card>
      <Card>
        <h2>Timeline summaries</h2>
        {timelineMetric.status === 'loading' ? (
          <Skeleton height="24px" width="80px" />
        ) : timelineMetric.status === 'needs-connect' ? (
          <p className={styles.metricValue}>Connect to view</p>
        ) : timelineMetric.status === 'error' ? (
          <div className={styles.inlineError}>
            <p>{timelineMetric.message}</p>
            <Button type="button" variant="secondary" onClick={() => loadSummary()}>
              Retry
            </Button>
          </div>
        ) : (
          <p className={styles.metricValue}>{timelineMetric.count}</p>
        )}
        <p className={styles.metricLabel}>Summaries generated from your Drive-backed artifacts.</p>
      </Card>
      <Card>
        <h2>Last sync</h2>
        <p className={styles.metricValue}>{lastSyncLabel}</p>
        <p className={styles.metricLabel}>Most recent sync for the Timeline workspace.</p>
      </Card>
    </div>
  );
}
