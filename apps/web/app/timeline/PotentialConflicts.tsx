'use client';

import React from 'react';
import Link from 'next/link';

import type { PotentialConflict } from '../lib/timeline/conflicts';
import Card from '../components/ui/Card';
import styles from './potentialConflicts.module.css';

type PotentialConflictsProps = {
  conflicts: PotentialConflict[];
  highlightedArtifactId?: string | null;
};

const truncate = (value?: string, max = 200) => {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

const badgeClass = (severity: PotentialConflict['severity']) => {
  if (severity === 'high') return styles.badgeHigh;
  if (severity === 'medium') return styles.badgeMedium;
  return styles.badgeLow;
};

export default function PotentialConflicts({ conflicts, highlightedArtifactId }: PotentialConflictsProps) {
  return (
    <Card className={styles.panel}>
      <div className={styles.header}>
        <h2>Potential conflicts</h2>
        <p>These items may be inconsistent across sources. Review the cited artifacts.</p>
      </div>

      {conflicts.length === 0 ? (
        <p className={styles.empty}>No potential conflicts detected in the current set.</p>
      ) : (
        <ul className={styles.list}>
          {conflicts.map((conflict) => {
            const isHighlighted =
              highlightedArtifactId &&
              conflict.artifacts.some((artifact) => artifact.artifactId === highlightedArtifactId);

            return (
              <li
                key={conflict.conflictId}
                className={`${styles.item} ${isHighlighted ? styles.highlighted : ''}`.trim()}
              >
                <div className={styles.row}>
                  <span className={`${styles.badge} ${badgeClass(conflict.severity)}`}>{conflict.severity}</span>
                  <p className={styles.summary}>{conflict.summary}</p>
                </div>
                <div className={styles.sources}>
                  {conflict.artifacts.map((artifact) => (
                    <Link
                      key={`${conflict.conflictId}-${artifact.artifactId}`}
                      href={`/timeline?artifactId=${encodeURIComponent(artifact.artifactId)}`}
                      className={styles.sourceChip}
                    >
                      {artifact.title || artifact.sourceLabel || artifact.artifactId}
                    </Link>
                  ))}
                </div>
                <details className={styles.details}>
                  <summary>Show details</summary>
                  <div className={styles.detailGrid}>
                    <div>
                      <div className={styles.detailLabel}>Left value</div>
                      <div>{conflict.details.leftValue || '—'}</div>
                    </div>
                    <div>
                      <div className={styles.detailLabel}>Right value</div>
                      <div>{conflict.details.rightValue || '—'}</div>
                    </div>
                  </div>
                  <div className={styles.evidenceBlock}>
                    <div>{truncate(conflict.artifacts[0].evidenceSnippet)}</div>
                    <div>{truncate(conflict.artifacts[1].evidenceSnippet)}</div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
