'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import { parseApiError } from '../lib/apiErrors';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import type { CalendarEntry, SummaryArtifact } from '../lib/types';
import { isCalendarEntry, normalizeCalendarEntry } from '../lib/validateCalendarEntry';
import { isSummaryArtifact, normalizeArtifact } from '../lib/validateArtifact';
import styles from './page.module.css';

type CalendarLayer = 'entry' | 'summary';

type CalendarDisplayItem = {
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  allDay: boolean;
  layer: CalendarLayer;
  entry?: CalendarEntry;
  summary?: SummaryArtifact;
};

type CalendarEntriesResponse = {
  entries?: CalendarEntry[];
};

type TimelineArtifactsResponse = {
  artifacts?: SummaryArtifact[];
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
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

const toLocalDayKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type CalendarGroup = {
  label: string;
  items: CalendarDisplayItem[];
};

const formatTimeRange = (start: string, end: string, allDay: boolean) => {
  if (allDay) {
    return 'All day';
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
    return `${start} - ${end}`;
  }
  return `${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`;
};

export default function CalendarPageClient() {
  const router = useRouter();
  const [items, setItems] = useState<CalendarDisplayItem[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null);
  const [showEntries, setShowEntries] = useState(true);
  const [showSummaries, setShowSummaries] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const loadCalendar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setRequestId(null);

    try {
      const [entriesResponse, summaryResponse] = await Promise.all([
        fetchWithTimeout('/api/calendar/entries', { signal }),
        fetchWithTimeout('/api/timeline/artifacts/list', { signal }),
      ]);

      if (!entriesResponse.ok) {
        const apiError = await parseApiError(entriesResponse);
        setRequestId(apiError?.requestId ?? null);
        throw new Error(apiError?.message ?? 'Unable to load calendar entries.');
      }

      if (!summaryResponse.ok) {
        const apiError = await parseApiError(summaryResponse);
        setRequestId(apiError?.requestId ?? null);
        throw new Error(apiError?.message ?? 'Unable to load timeline summaries.');
      }

      const entryPayload = (await entriesResponse.json()) as CalendarEntriesResponse;
      const summaryPayload = (await summaryResponse.json()) as TimelineArtifactsResponse;

      const calendarEntries = Array.isArray(entryPayload.entries)
        ? entryPayload.entries.filter(isCalendarEntry).map(normalizeCalendarEntry)
        : [];
      const summaries = Array.isArray(summaryPayload.artifacts)
        ? summaryPayload.artifacts.filter(isSummaryArtifact).map(normalizeArtifact)
        : [];

      const entryItems: CalendarDisplayItem[] = calendarEntries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        startISO: entry.startISO,
        endISO: entry.endISO,
        allDay: entry.allDay,
        layer: 'entry',
        entry,
      }));

      const summaryItems: CalendarDisplayItem[] = summaries.map((artifact) => ({
        id: artifact.driveFileId ? artifact.driveFileId : artifact.artifactId,
        title: artifact.title || artifact.sourceMetadata?.subject || 'Timeline summary',
        startISO: artifact.createdAtISO,
        endISO: artifact.createdAtISO,
        allDay: true,
        layer: 'summary',
        summary: artifact,
      }));

      setItems([...entryItems, ...summaryItems]);
      setSelectedEntry(null);
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
    const filtered = items.filter((item) => {
      if (item.layer === 'entry') {
        return showEntries;
      }
      return showSummaries;
    });

    return filtered.reduce<Record<string, CalendarGroup>>((acc, item) => {
      const dateKey = toLocalDayKey(item.startISO);
      if (acc[dateKey]) {
        acc[dateKey].items = [...acc[dateKey].items, item];
        return acc;
      }
      acc[dateKey] = {
        label: formatDateLabel(item.startISO),
        items: [item],
      };
      return acc;
    }, {});
  }, [items, showEntries, showSummaries]);

  const dates = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Calendar</p>
          <h1>Snapshot view</h1>
          <p>A quick glance at the scheduled sessions grouped by date.</p>
        </div>
        <div className={styles.headerActions}>
          <Button type="button" variant="secondary" onClick={() => loadCalendar()}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <div className={styles.toggles}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showEntries}
              onChange={(event) => setShowEntries(event.target.checked)}
            />
            <span>My Calendar Entries</span>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showSummaries}
              onChange={(event) => setShowSummaries(event.target.checked)}
            />
            <span>Timeline Summaries</span>
          </label>
        </div>
      </Card>

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
          {requestId ? <p className={styles.requestId}>Request ID: {requestId}</p> : null}
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
        <div className={styles.content}>
          <div className={styles.list}>
            {dates.map((dateKey) => (
              <Card key={dateKey}>
                <div className={styles.dateRow}>
                  <h2 data-testid="calendar-date" data-date-key={dateKey}>
                    {grouped[dateKey].label}
                  </h2>
                  <span className={styles.count}>{grouped[dateKey].items.length} sessions</span>
                </div>
                <div className={styles.items}>
                  {grouped[dateKey].items.map((item) => (
                    <div key={`${item.layer}-${item.id}`} className={styles.itemRow}>
                      <button
                        type="button"
                        className={styles.itemButton}
                        onClick={() => {
                          if (item.layer === 'summary') {
                            router.push(`/timeline?artifactId=${encodeURIComponent(item.id)}`);
                            return;
                          }
                          if (item.entry) {
                            setSelectedEntry(item.entry);
                          }
                        }}
                      >
                        <div>
                          <div className={styles.itemTitle}>
                            <h3>{item.title}</h3>
                            {item.layer === 'summary' ? (
                              <Badge tone="accent">Timeline summary</Badge>
                            ) : (
                              <Badge tone="neutral">Calendar entry</Badge>
                            )}
                          </div>
                          <p className={styles.time}>
                            {formatTimeRange(item.startISO, item.endISO, item.allDay)}
                          </p>
                        </div>
                        <span className={styles.location}>
                          {item.entry?.location ?? (item.layer === 'summary' ? 'Timeline' : '')}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
          <aside className={styles.drawer}>
            {selectedEntry ? (
              <Card>
                <h2>Entry details</h2>
                <p className={styles.drawerTitle}>{selectedEntry.title}</p>
                <p className={styles.drawerMeta}>
                  {formatDateLabel(selectedEntry.startISO)} ·{' '}
                  {formatTimeRange(selectedEntry.startISO, selectedEntry.endISO, selectedEntry.allDay)}
                </p>
                {selectedEntry.location ? (
                  <p>
                    <strong>Location:</strong> {selectedEntry.location}
                  </p>
                ) : null}
                {selectedEntry.notes ? (
                  <p>
                    <strong>Notes:</strong> {selectedEntry.notes}
                  </p>
                ) : null}
                {selectedEntry.tags && selectedEntry.tags.length > 0 ? (
                  <div className={styles.tagList}>
                    {selectedEntry.tags.map((tag) => (
                      <Badge key={tag} tone="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {selectedEntry.links && selectedEntry.links.length > 0 ? (
                  <div className={styles.linkList}>
                    <strong>Links</strong>
                    <ul>
                      {selectedEntry.links.map((link) => (
                        <li key={`${link.kind}-${link.id}`}>
                          {link.url ? (
                            <a href={link.url} target="_blank" rel="noreferrer">
                              {link.kind.replace('_', ' ')} · {link.id}
                            </a>
                          ) : (
                            <span>
                              {link.kind.replace('_', ' ')} · {link.id}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
            ) : (
              <Card>
                <h2>Entry details</h2>
                <p>Select a calendar entry to review details.</p>
              </Card>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
