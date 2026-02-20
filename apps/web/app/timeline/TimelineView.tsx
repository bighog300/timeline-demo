'use client';

import Link from 'next/link';
import React, { useEffect } from 'react';

import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import type { SummaryArtifact } from '../lib/types';
import styles from './timelineView.module.css';

type TimelineArtifact = {
  entryKey: string;
  artifact: SummaryArtifact;
};

type TimelineGroup = {
  key: string;
  label: string;
  artifacts: TimelineArtifact[];
  undated?: boolean;
};

type TimelineViewProps = {
  artifacts: TimelineArtifact[];
  highlightedArtifactId?: string | null;
};

const toValidDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateLabel = (isoDate: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00.000Z`));

const firstSentence = (text?: string) => {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentence = normalized.split(/(?<=[.!?])\s/)[0] ?? normalized;
  return sentence.trim();
};

const toBullets = (artifact: SummaryArtifact) => {
  if (artifact.highlights?.length) {
    return artifact.highlights.slice(0, 3);
  }
  const parts = artifact.summary
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  return parts.length ? parts : [artifact.summary.slice(0, 180)];
};

const sourceTypeLabel = (artifact: SummaryArtifact) => {
  if (artifact.source === 'drive') return 'Drive';
  if (artifact.source === 'gmail') return 'Gmail';
  return artifact.source;
};

const groupTimelineArtifacts = (artifacts: TimelineArtifact[]): TimelineGroup[] => {
  const dated = new Map<string, TimelineArtifact[]>();
  const undated: TimelineArtifact[] = [];

  artifacts.forEach((item) => {
    const date = toValidDate(item.artifact.contentDateISO);
    if (!date) {
      undated.push(item);
      return;
    }
    const key = date.toISOString().slice(0, 10);
    const items = dated.get(key) ?? [];
    items.push(item);
    dated.set(key, items);
  });

  const groups = Array.from(dated.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => ({
      key,
      label: formatDateLabel(key),
      artifacts: [...entries].sort((a, b) => {
        const aDate = a.artifact.contentDateISO ?? '';
        const bDate = b.artifact.contentDateISO ?? '';
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        return a.artifact.artifactId.localeCompare(b.artifact.artifactId);
      }),
    }));

  if (undated.length) {
    groups.push({
      key: 'undated',
      label: 'Undated',
      undated: true,
      artifacts: undated.sort((a, b) => a.artifact.artifactId.localeCompare(b.artifact.artifactId)),
    });
  }

  return groups;
};

export default function TimelineView({ artifacts, highlightedArtifactId }: TimelineViewProps) {
  const groups = groupTimelineArtifacts(artifacts);

  useEffect(() => {
    if (!highlightedArtifactId) return;
    const target = document.querySelector(`[data-artifact-id="${highlightedArtifactId}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedArtifactId]);

  if (!artifacts.length) {
    return (
      <Card className={styles.emptyState}>
        <h2>No summaries yet.</h2>
        <Link href="/select/drive">
          <Button variant="secondary">Select documents</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className={styles.timeline}>
      {groups.map((group) => (
        <section key={group.key} className={styles.group}>
          <h3 className={styles.groupHeader}>{group.label}</h3>
          {group.undated ? (
            <p className={styles.undatedHelp}>No clear date detected in source.</p>
          ) : null}
          <div className={styles.items}>
            {group.artifacts.map(({ entryKey, artifact }) => {
              const title = firstSentence(artifact.summary) || artifact.title || 'Untitled summary';
              const bullets = toBullets(artifact);
              const participants = artifact.participants?.join(', ');
              const entities = artifact.entities?.map((entity) => entity.name).join(', ');
              const people = participants || entities;
              const externalLink = artifact.driveWebViewLink || `https://drive.google.com/file/d/${artifact.driveFileId}/view`;
              const internalLink = `/timeline?artifactId=${encodeURIComponent(artifact.driveFileId)}`;
              const isHighlighted =
                highlightedArtifactId === artifact.driveFileId ||
                highlightedArtifactId === artifact.artifactId;

              return (
                <Card
                  key={artifact.artifactId}
                  className={`${styles.item} ${isHighlighted ? styles.highlighted : ''}`.trim()}
                  data-entry-key={entryKey}
                  data-artifact-id={artifact.driveFileId}
                >
                  <h4 className={styles.itemTitle}>{title}</h4>
                  <ul className={styles.bullets}>
                    {bullets.map((line, index) => (
                      <li key={`${artifact.artifactId}-line-${index}`}>{line}</li>
                    ))}
                  </ul>
                  <div className={styles.metaRow}>
                    <span>{sourceTypeLabel(artifact)}</span>
                    {people ? <span>• {people}</span> : null}
                    <a href={externalLink} target="_blank" rel="noreferrer">
                      View source
                    </a>
                    <Link href={internalLink}>Jump to summary</Link>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export { groupTimelineArtifacts };
