'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import styles from './page.module.css';

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

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

const formatDateLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return dateFormatter.format(date);
};

const formatTimeRange = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
    return `${start} - ${end}`;
  }
  return `${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`;
};

export default function CalendarPageClient() {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCalendar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchWithTimeout('/api/calendar', { signal });
      if (!response.ok) {
        throw new Error('Unable to load calendar.');
      }
      const data = (await response.json()) as CalendarResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setError('Unable to load calendar snapshot. Please retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadCalendar(controller.signal);
    return () => controller.abort();
  }, [loadCalendar]);

  const grouped = useMemo(() => {
    return items.reduce<Record<string, CalendarItem[]>>((acc, item) => {
      const dateKey = formatDateLabel(item.start);
      acc[dateKey] = acc[dateKey] ? [...acc[dateKey], item] : [item];
      return acc;
    }, {});
  }, [items]);

  const dates = Object.keys(grouped);

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Calendar</p>
          <h1>Snapshot view</h1>
          <p>A quick glance at the scheduled sessions grouped by date.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => loadCalendar()}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className={styles.list}>
          {[...Array(3)].map((_, index) => (
            <Card key={`calendar-skeleton-${index}`}>
              <Skeleton height="18px" width="40%" />
              <Skeleton height="14px" width="60%" style={{ marginTop: '10px' }} />
              <Skeleton height="14px" width="50%" style={{ marginTop: '6px' }} />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <h2>Calendar unavailable</h2>
          <p>{error}</p>
          <Button type="button" onClick={() => loadCalendar()}>
            Retry
          </Button>
        </Card>
      ) : dates.length === 0 ? (
        <Card>
          <h2>No calendar items</h2>
          <p>There are no scheduled sessions in the snapshot.</p>
        </Card>
      ) : (
        <div className={styles.list}>
          {dates.map((dateKey) => (
            <Card key={dateKey}>
              <div className={styles.dateRow}>
                <h2>{dateKey}</h2>
                <span className={styles.count}>{grouped[dateKey].length} sessions</span>
              </div>
              <div className={styles.items}>
                {grouped[dateKey].map((item) => (
                  <div key={item.id} className={styles.itemRow}>
                    <div>
                      <h3>{item.title}</h3>
                      <p className={styles.time}>{formatTimeRange(item.start, item.end)}</p>
                    </div>
                    <span className={styles.location}>{item.location}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
