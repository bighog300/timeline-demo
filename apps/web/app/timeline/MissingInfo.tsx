'use client';

import React, { useMemo, useState } from 'react';

import type { TimelineArtifact } from '../lib/timeline/exportBuilder';
import { sourceTypeLabel, timelineCardTitle } from '../lib/timeline/exportBuilder';
import { computeMissingInfo, getArtifactsByIds, type MissingInfoResult } from '../lib/timeline/missingInfo';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import styles from './missingInfo.module.css';

type CategoryKey = 'entities' | 'location' | 'amount';

type Props = {
  artifacts: TimelineArtifact[];
  onApplied?: () => void | Promise<void>;
};

const emptyPatch = { entities: '', location: '', amount: '', note: '' };

export default function MissingInfo({ artifacts, onApplied }: Props) {
  const [openCategory, setOpenCategory] = useState<CategoryKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [patchById, setPatchById] = useState<Record<string, typeof emptyPatch>>({});
  const [localAnnotations, setLocalAnnotations] = useState<Record<string, TimelineArtifact['artifact']['userAnnotations']>>({});

  const mergedArtifacts = useMemo(() => artifacts.map((item) => ({
    ...item,
    artifact: {
      ...item.artifact,
      userAnnotations: localAnnotations[item.artifact.driveFileId] ?? item.artifact.userAnnotations,
    },
  })), [artifacts, localAnnotations]);

  const missing = useMemo(() => computeMissingInfo(mergedArtifacts), [mergedArtifacts]);

  const openIds = openCategory === 'entities'
    ? missing.missingEntitiesIds
    : openCategory === 'location'
      ? missing.missingLocationIds
      : openCategory === 'amount'
        ? missing.missingAmountIds
        : [];

  const rows = getArtifactsByIds(mergedArtifacts, openIds);

  const setField = (artifactId: string, field: keyof typeof emptyPatch, value: string) => {
    setPatchById((prev) => ({
      ...prev,
      [artifactId]: { ...emptyPatch, ...prev[artifactId], [field]: value },
    }));
  };

  const save = async (artifactId: string) => {
    const current = patchById[artifactId] ?? emptyPatch;
    const entities = current.entities
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    setSavingFor(artifactId);
    setMessage(null);
    try {
      const response = await fetch('/api/timeline/quality/apply-annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId,
          patch: {
            entities,
            location: current.location,
            amount: current.amount,
            note: current.note,
          },
        }),
      });
      if (!response.ok) return;
      const payload = await response.json() as { userAnnotations?: TimelineArtifact['artifact']['userAnnotations'] };
      setLocalAnnotations((prev) => ({ ...prev, [artifactId]: payload.userAnnotations ?? {} }));
      setMessage('Annotation saved');
      await onApplied?.();
    } finally {
      setSavingFor(null);
    }
  };

  const Row = ({ label, count, onFix }: { label: string; count: number; onFix?: () => void }) => (
    <div className={styles.row}>
      <span>{label}: {count}</span>
      {onFix ? <Button variant="ghost" onClick={onFix}>Fix</Button> : <a href="#timeline-quality">Fix in Timeline quality</a>}
    </div>
  );

  return (
    <Card className={styles.panel}>
      <h2>Missing info</h2>
      <Row label="Entities missing" count={missing.missingEntitiesIds.length} onFix={() => setOpenCategory('entities')} />
      <Row label="Location missing" count={missing.missingLocationIds.length} onFix={() => setOpenCategory('location')} />
      <Row label="Amount missing" count={missing.missingAmountIds.length} onFix={() => setOpenCategory('amount')} />
      <Row label="Date missing" count={missing.missingDateIds.length} />

      {openCategory ? (
        <div className={styles.modal}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <strong>Fix missing {openCategory}</strong>
              <Button variant="ghost" onClick={() => setOpenCategory(null)}>Close</Button>
            </div>
            {rows.map(({ artifact }) => {
              const form = patchById[artifact.driveFileId] ?? emptyPatch;
              return (
                <div key={artifact.driveFileId} className={styles.item}>
                  <div className={styles.itemTitle}>{timelineCardTitle(artifact)}</div>
                  <div className={styles.meta}>{sourceTypeLabel(artifact)} · {artifact.contentDateISO ? artifact.contentDateISO.slice(0, 10) : 'Undated'}</div>
                  <div className={styles.suggestion}>Source text preview: {(artifact.summary || '').slice(0, 120)}</div>
                  <label>Entities (comma separated)
                    <input value={form.entities} onChange={(e) => setField(artifact.driveFileId, 'entities', e.target.value)} />
                  </label>
                  <label>Location
                    <input value={form.location} onChange={(e) => setField(artifact.driveFileId, 'location', e.target.value)} />
                  </label>
                  <label>Amount
                    <input value={form.amount} onChange={(e) => setField(artifact.driveFileId, 'amount', e.target.value)} />
                  </label>
                  <label>Note (optional)
                    <textarea value={form.note} onChange={(e) => setField(artifact.driveFileId, 'note', e.target.value)} rows={2} />
                  </label>
                  <Button variant="secondary" onClick={() => void save(artifact.driveFileId)} disabled={savingFor === artifact.driveFileId}>
                    {savingFor === artifact.driveFileId ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              );
            })}
            {rows.length === 0 ? <p>Nothing left to fix in this category.</p> : null}
            {message ? <div className={styles.success}>{message}</div> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export type { MissingInfoResult };
