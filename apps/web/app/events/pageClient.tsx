'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import styles from './page.module.css';

type EventItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  venue: string;
  city: string;
  category: string;
  price_range: string;
  url: string;
  tags: string[];
};

const formatDateRange = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
    return `${start} - ${end}`;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
};

export default function EventsPageClient() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchWithTimeout('/api/events', { signal });
      if (!response.ok) {
        throw new Error('Unable to load events.');
      }
      const data = (await response.json()) as EventItem[];
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setError('Unable to load events. Please retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadEvents(controller.signal);
    return () => controller.abort();
  }, [loadEvents]);

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Events</p>
          <h1>Upcoming experiences</h1>
          <p>Browse the latest upcoming events and see how the API data is rendered.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => loadEvents()}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className={styles.grid}>
          {[...Array(3)].map((_, index) => (
            <Card key={`event-skeleton-${index}`}>
              <Skeleton height="20px" width="70%" />
              <Skeleton height="14px" width="50%" style={{ marginTop: '12px' }} />
              <Skeleton height="14px" width="60%" style={{ marginTop: '8px' }} />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <h2>We hit a snag</h2>
          <p>{error}</p>
          <Button type="button" onClick={() => loadEvents()}>
            Retry
          </Button>
        </Card>
      ) : events.length === 0 ? (
        <Card>
          <h2>No events yet</h2>
          <p>Check back soon for new experiences added to the timeline.</p>
        </Card>
      ) : (
        <div className={styles.grid}>
          {events.map((eventItem) => (
            <Card key={eventItem.id} className={styles.eventCard}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>{eventItem.title}</h2>
                  <p className={styles.date}>{formatDateRange(eventItem.start, eventItem.end)}</p>
                </div>
                <Badge tone="accent">{eventItem.category}</Badge>
              </div>
              <p className={styles.location}>
                {eventItem.venue} • {eventItem.city}
              </p>
              <div className={styles.metaRow}>
                <span className={styles.price}>{eventItem.price_range}</span>
                <div className={styles.tagRow}>
                  {eventItem.tags.map((tag) => (
                    <Badge key={`${eventItem.id}-${tag}`} tone="neutral">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
              {eventItem.url ? (
                <Link className={styles.link} href={eventItem.url} target="_blank">
                  View details
                </Link>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
