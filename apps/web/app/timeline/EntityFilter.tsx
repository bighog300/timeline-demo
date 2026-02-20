'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import Button from '../components/ui/Button';
import styles from './entityFilter.module.css';

type Props = {
  entities: string[];
  counts: Record<string, number>;
  value: string | null;
  onChange: (next: string | null) => void;
};

const MAX_SUGGESTIONS = 10;

export default function EntityFilter({ entities, counts, value, onChange }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(value ?? '');

  useEffect(() => {
    setQuery(value ?? '');
  }, [value]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return entities.slice(0, MAX_SUGGESTIONS);
    }
    return entities
      .filter((entity) => entity.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [entities, query]);

  const commitSelection = (next: string | null) => {
    const normalized = next?.trim() ? next.trim() : null;
    setQuery(normalized ?? '');
    onChange(normalized);

    if (typeof window !== 'undefined') {
      if (normalized) {
        window.localStorage.setItem('timeline.entityFilter', normalized);
      } else {
        window.localStorage.removeItem('timeline.entityFilter');
      }
    }

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (normalized) {
      params.set('entity', normalized);
    } else {
      params.delete('entity');
    }
    const nextQuery = params.toString();
    router.replace(nextQuery ? `/timeline?${nextQuery}` : '/timeline');
  };

  return (
    <div className={styles.container}>
      <label className={styles.label} htmlFor="entity-filter-input">Filter by entity</label>
      <div className={styles.inputRow}>
        <input
          id="entity-filter-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people or organizations"
          className={styles.input}
        />
        <button
          type="button"
          aria-label="Clear entity filter"
          className={styles.clearButton}
          onClick={() => commitSelection(null)}
        >
          ×
        </button>
      </div>

      {entities.length === 0 ? (
        <p className={styles.empty}>No entities detected yet.</p>
      ) : (
        <ul className={styles.suggestions}>
          {suggestions.map((entity) => (
            <li key={entity}>
              <button
                type="button"
                className={styles.suggestionButton}
                onClick={() => commitSelection(entity)}
              >
                <span>{entity}</span>
                <span className={styles.count}>{counts[entity] ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {value ? (
        <div className={styles.pillRow}>
          <span className={styles.pill}>Entity: {value}</span>
          <Button variant="ghost" onClick={() => commitSelection(null)}>Clear</Button>
        </div>
      ) : null}
    </div>
  );
}
