'use client';

import React, { useCallback, useEffect, useState } from 'react';

import Button from './ui/Button';
import Card from './ui/Card';
import Skeleton from './ui/Skeleton';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import styles from '../page.module.css';

type CalendarItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
};

type CalendarResponse = {
  items: CalendarItem[];
};

export default function HomeClient() {
  const [eventsCount, setEventsCount] = useState<number | null>(null);
  const [calendarCount, setCalendarCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const [eventsResponse, calendarResponse] = await Promise.all([
        fetchWithTimeout('/api/events', { signal }),
        fetchWithTimeout('/api/calendar', { signal }),
      ]);

      if (!eventsResponse.ok || !calendarResponse.ok) {
        throw new Error('Unable to load summary data.');
      }

      const eventsData = (await eventsResponse.json()) as Array<{ id: string }>;
      const calendarData = (await calendarResponse.json()) as CalendarResponse;

      setEventsCount(Array.isArray(eventsData) ? eventsData.length : 0);
      setCalendarCount(Array.isArray(calendarData.items) ? calendarData.items.length : 0);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setError('Unable to load summary data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSummary(controller.signal);
    return () => controller.abort();
  }, [loadSummary]);

  return (
    <div className={styles.summaryGrid}>
      <Card>
        <h2>Overview</h2>
        <p>
          This demo showcases a timeline-aware interface powered entirely by mock API routes. Explore
          the events, calendar snapshot, and chat experience without any backend dependencies.
        </p>
      </Card>
      <Card>
        <h2>Upcoming events</h2>
        {loading ? (
          <Skeleton height="24px" width="80px" />
        ) : error ? (
          <div className={styles.inlineError}>
            <p>{error}</p>
            <Button type="button" variant="secondary" onClick={() => loadSummary()}>
              Retry
            </Button>
          </div>
        ) : (
          <p className={styles.metricValue}>{eventsCount ?? 0}</p>
        )}
        <p className={styles.metricLabel}>Events currently in the pipeline.</p>
      </Card>
      <Card>
        <h2>Calendar blocks</h2>
        {loading ? (
          <Skeleton height="24px" width="80px" />
        ) : error ? (
          <div className={styles.inlineError}>
            <p>{error}</p>
            <Button type="button" variant="secondary" onClick={() => loadSummary()}>
              Retry
            </Button>
          </div>
        ) : (
          <p className={styles.metricValue}>{calendarCount ?? 0}</p>
        )}
        <p className={styles.metricLabel}>Scheduled sessions in the snapshot.</p>
      </Card>
    </div>
  );
}
