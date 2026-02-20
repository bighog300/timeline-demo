'use client';

import React, { useMemo, useState } from 'react';

import type { TimelineArtifact } from '../lib/timeline/exportBuilder';
import { sourceTypeLabel, timelineCardTitle } from '../lib/timeline/exportBuilder';
import { getUndatedArtifacts, summarizeDateCoverage } from '../lib/timeline/quality';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import styles from './timelineQuality.module.css';

type Candidate = {
  dateISO: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'contentDateISO' | 'sourceMetadata' | 'text_regex' | 'llm';
  evidenceSnippet?: string;
};

type Props = {
  artifacts: TimelineArtifact[];
  onDateApplied?: () => void | Promise<void>;
};

const previewText = (artifact: TimelineArtifact['artifact']) => {
  const value = artifact.sourcePreview || artifact.summary;
  return value.length > 160 ? `${value.slice(0, 160)}…` : value;
};

export default function TimelineQuality({ artifacts, onDateApplied }: Props) {
  const [isFixerOpen, setIsFixerOpen] = useState(false);
  const [undatedLocal, setUndatedLocal] = useState(() => getUndatedArtifacts(artifacts));
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const [applyingFor, setApplyingFor] = useState<string | null>(null);
  const [candidatesById, setCandidatesById] = useState<Record<string, Candidate[]>>({});
  const [selectedById, setSelectedById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  React.useEffect(() => {
    setUndatedLocal(getUndatedArtifacts(artifacts));
  }, [artifacts]);

  const coverage = useMemo(() => summarizeDateCoverage(artifacts), [artifacts]);

  const handleFindDate = async (artifactId: string) => {
    setLoadingFor(artifactId);
    setMessage(null);
    try {
      const response = await fetch('/api/timeline/quality/date-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactId }),
      });
      const payload = (await response.json()) as { candidates?: Candidate[] };
      setCandidatesById((prev) => ({ ...prev, [artifactId]: payload.candidates ?? [] }));
      if ((payload.candidates ?? []).length > 0) {
        setSelectedById((prev) => ({ ...prev, [artifactId]: payload.candidates?.[0]?.dateISO ?? '' }));
      }
    } finally {
      setLoadingFor(null);
    }
  };

  const handleApply = async (artifactId: string) => {
    const contentDateISO = selectedById[artifactId];
    if (!contentDateISO) return;
    setApplyingFor(artifactId);
    setMessage(null);
    try {
      const response = await fetch('/api/timeline/quality/apply-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactId, contentDateISO }),
      });
      if (!response.ok) return;
      setUndatedLocal((prev) => prev.filter((item) => item.artifact.driveFileId !== artifactId));
      setMessage('Date applied');
      await onDateApplied?.();
    } finally {
      setApplyingFor(null);
    }
  };

  return (
    <Card id="timeline-quality" className={styles.panel}>
      <h2>Timeline quality</h2>
      <div className={styles.counts}>
        <span className={styles.countChip}>Total: {coverage.total}</span>
        <span className={styles.countChip}>Dated: {coverage.dated}</span>
        <span className={styles.countChip}>Undated: {coverage.undated}</span>
      </div>

      {coverage.undated > 0 ? (
        <>
          <p className={styles.notice}>
            Undated items appear at the bottom and reduce chronological completeness.
          </p>
          <Button variant="secondary" onClick={() => setIsFixerOpen((prev) => !prev)}>
            {isFixerOpen ? 'Hide undated fixer' : 'Fix undated dates'}
          </Button>
        </>
      ) : (
        <p className={styles.notice}>All timeline artifacts are dated.</p>
      )}

      {isFixerOpen ? (
        <div className={styles.fixer}>
          {undatedLocal.length === 0 ? <p>Nothing left to fix.</p> : null}
          {undatedLocal.map(({ artifact }) => {
            const key = artifact.driveFileId;
            const candidates = candidatesById[key] ?? [];
            return (
              <div key={key} className={styles.artifactRow}>
                <strong>{timelineCardTitle(artifact)}</strong>
                <div className={styles.meta}>
                  {sourceTypeLabel(artifact)} · Created {new Date(artifact.createdAtISO).toLocaleString()}
                </div>
                <p className={styles.preview}>{previewText(artifact)}</p>
                <Button variant="ghost" onClick={() => void handleFindDate(key)} disabled={loadingFor === key}>
                  {loadingFor === key ? 'Finding...' : 'Find date'}
                </Button>

                {candidates.length > 0 ? (
                  <div className={styles.candidates}>
                    {candidates.map((candidate) => (
                      <label key={`${key}-${candidate.dateISO}-${candidate.source}`} className={styles.candidate}>
                        <input
                          type="radio"
                          name={`candidate-${key}`}
                          value={candidate.dateISO}
                          checked={selectedById[key] === candidate.dateISO}
                          onChange={(event) =>
                            setSelectedById((prev) => ({ ...prev, [key]: event.target.value }))
                          }
                        />{' '}
                        {candidate.dateISO} ({candidate.source})
                        {candidate.evidenceSnippet ? <div>{candidate.evidenceSnippet}</div> : null}
                        {candidate.confidence === 'low' ? (
                          <div className={styles.warning}>Low confidence. Please verify before applying.</div>
                        ) : null}
                      </label>
                    ))}
                    <Button variant="secondary" onClick={() => void handleApply(key)} disabled={applyingFor === key || !selectedById[key]}>
                      {applyingFor === key ? 'Applying...' : 'Apply'}
                    </Button>
                  </div>
                ) : null}

                {candidatesById[key] && candidates.length === 0 ? (
                  <p>No reliable date detected — leave undated.</p>
                ) : null}
              </div>
            );
          })}
          {message ? <div className={styles.success}>{message}</div> : null}
        </div>
      ) : null}
    </Card>
  );
}
