'use client';

import React, { useEffect, useMemo, useState } from 'react';

import type { SummaryArtifact } from '../lib/types';
import { sourceTypeLabel, timelineCardTitle } from '../lib/timeline/exportBuilder';
import Button from '../components/ui/Button';
import styles from './artifactDetailsDrawer.module.css';

type UserAnnotations = SummaryArtifact['userAnnotations'];

type TimelineArtifact = {
  entryKey: string;
  artifact: SummaryArtifact;
};

type ArtifactDetailsDrawerProps = {
  isOpen: boolean;
  artifactId: string | null;
  artifact?: TimelineArtifact | null;
  onClose: () => void;
  onSaved: (artifactId: string, userAnnotations: UserAnnotations | null) => void;
};

type DrawerErrorState = 'auth' | 'denied' | 'validation' | 'server' | 'generic';

const toEntityChips = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toPatch = (state: {
  entitiesText: string;
  location: string;
  amount: string;
  note: string;
}) => ({
  entities: toEntityChips(state.entitiesText),
  location: state.location.trim(),
  amount: state.amount.trim(),
  note: state.note.trim(),
});

export default function ArtifactDetailsDrawer({
  isOpen,
  artifactId,
  artifact,
  onClose,
  onSaved,
}: ArtifactDetailsDrawerProps) {
  const [fetchedArtifact, setFetchedArtifact] = useState<SummaryArtifact | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<DrawerErrorState | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);

  const [entitiesText, setEntitiesText] = useState('');
  const [location, setLocation] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const activeArtifact = artifact?.artifact ?? fetchedArtifact;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSaveError(null);
    setSavedMessage(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (artifact?.artifact) {
      setFetchedArtifact(null);
      return;
    }
    if (!artifactId) {
      return;
    }

    let isMounted = true;
    const run = async () => {
      setIsLoading(true);
      setLoadError(null);
      setLoadErrorMessage(null);
      try {
        const response = await fetch(`/api/timeline/artifacts/read?fileId=${encodeURIComponent(artifactId)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
          if (!isMounted) return;
          const code = payload?.error?.code;
          if (response.status === 401) {
            setLoadError('auth');
          } else if (response.status === 403) {
            setLoadError('denied');
          } else if (response.status >= 500) {
            setLoadError('server');
          } else {
            setLoadError('validation');
          }
          setLoadErrorMessage(payload?.error?.message ?? code ?? 'Unable to load artifact details.');
          return;
        }

        const payload = (await response.json()) as { artifact?: SummaryArtifact };
        if (!isMounted) return;
        setFetchedArtifact(payload.artifact ?? null);
      } catch {
        if (!isMounted) return;
        setLoadError('generic');
        setLoadErrorMessage('Unable to load artifact details.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void run();
    return () => {
      isMounted = false;
    };
  }, [artifact, artifactId, isOpen]);

  useEffect(() => {
    const ua = activeArtifact?.userAnnotations;
    setEntitiesText(ua?.entities?.join(', ') ?? '');
    setLocation(ua?.location ?? '');
    setAmount(ua?.amount ?? '');
    setNote(ua?.note ?? '');
  }, [activeArtifact?.artifactId, activeArtifact?.userAnnotations]);

  const extractedEntities = useMemo(() => {
    const fromStructured = activeArtifact?.entities?.map((item) => item.name).filter(Boolean) ?? [];
    const fromParticipants = activeArtifact?.participants ?? [];
    return Array.from(new Set([...fromStructured, ...fromParticipants]));
  }, [activeArtifact?.entities, activeArtifact?.participants]);

  const handleSave = async () => {
    if (!activeArtifact) return;

    setIsSaving(true);
    setSaveError(null);
    setSavedMessage(null);

    const patch = toPatch({ entitiesText, location, amount, note });

    try {
      const response = await fetch('/api/timeline/quality/apply-annotation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactId: activeArtifact.driveFileId, patch }),
      });

      const payload = await response.json().catch(() => null) as
        | { userAnnotations?: UserAnnotations; error?: { message?: string } }
        | null;

      if (!response.ok) {
        if (response.status === 401) {
          setSaveError('Sign in required.');
        } else if (response.status === 403) {
          setSaveError('Access denied.');
        } else if (response.status >= 500) {
          setSaveError('Server error. Please retry.');
        } else {
          setSaveError(payload?.error?.message ?? 'Unable to save annotations.');
        }
        return;
      }

      const saved = payload?.userAnnotations ?? null;
      onSaved(activeArtifact.driveFileId, saved && Object.keys(saved).length ? saved : null);
      setSavedMessage('Saved');
    } catch {
      setSaveError('Unable to save annotations.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = async () => {
    if (!artifactId) return;
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const path = `/timeline?artifactId=${encodeURIComponent(artifactId)}`;
    const full = `${base}${path}`;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(full);
      setSavedMessage('Link copied');
      return;
    }

    if (typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.value = full;
      document.body.appendChild(input);
      input.focus();
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setSavedMessage('Link copied');
    }
  };

  if (!isOpen) return null;

  const title = activeArtifact ? timelineCardTitle(activeArtifact) : 'Artifact details';
  const sourceLabel = activeArtifact ? sourceTypeLabel(activeArtifact) : '—';
  const dateLabel = activeArtifact?.contentDateISO
    ? new Date(activeArtifact.contentDateISO).toLocaleString()
    : 'Undated';
  const externalLink = activeArtifact
    ? activeArtifact.driveWebViewLink || `https://drive.google.com/file/d/${activeArtifact.driveFileId}/view`
    : null;

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Artifact details"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div>
            <h2>{title}</h2>
            <p>{dateLabel} · {sourceLabel}</p>
          </div>
          <div className={styles.actions}>
            {externalLink ? (
              <a href={externalLink} target="_blank" rel="noreferrer" className={styles.linkButton}>
                Open source
              </a>
            ) : null}
            <Button variant="ghost" onClick={() => void handleCopyLink()} disabled={!artifactId}>Copy link</Button>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </header>

        {isLoading ? <p>Loading artifact details…</p> : null}
        {loadError ? (
          <div className={styles.error}>
            {loadError === 'auth' ? 'Sign in required.' : null}
            {loadError === 'denied' ? 'Access denied.' : null}
            {loadError === 'server' ? 'Server error. Please retry.' : null}
            {loadError === 'validation' || loadError === 'generic' ? loadErrorMessage : null}
          </div>
        ) : null}

        {activeArtifact ? (
          <>
            <section className={styles.section}>
              <h3>Summary</h3>
              <p>{activeArtifact.summary}</p>
              {activeArtifact.highlights?.length ? (
                <ul>
                  {activeArtifact.highlights.map((line, index) => (
                    <li key={`${activeArtifact.artifactId}-hl-${index}`}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className={styles.section}>
              <h3>Entities</h3>
              <p className={styles.subhead}>Extracted entities</p>
              <div className={styles.chips}>
                {extractedEntities.length ? extractedEntities.map((entity) => <span key={entity} className={styles.chip}>{entity}</span>) : <span>None</span>}
              </div>
              <p className={styles.subhead}>User entities</p>
              <div className={styles.chips}>
                {toEntityChips(entitiesText).length ? toEntityChips(entitiesText).map((entity) => <span key={entity} className={styles.chipUser}>{entity}</span>) : <span>None</span>}
              </div>
            </section>

            <section className={styles.section}>
              <h3>User annotations</h3>
              <label>
                Entities (comma-separated)
                <input
                  value={entitiesText}
                  onChange={(event) => setEntitiesText(event.target.value)}
                  maxLength={400}
                  aria-label="Entities (comma-separated)"
                />
              </label>
              <label>
                Location
                <input aria-label="Location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} />
              </label>
              <label>
                Amount
                <input aria-label="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={200} />
              </label>
              <label>
                Note
                <textarea aria-label="Note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
              </label>

              <div className={styles.actions}>
                <Button onClick={() => void handleSave()} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</Button>
                <Button variant="ghost" onClick={() => {
                  setEntitiesText(activeArtifact.userAnnotations?.entities?.join(', ') ?? '');
                  setLocation(activeArtifact.userAnnotations?.location ?? '');
                  setAmount(activeArtifact.userAnnotations?.amount ?? '');
                  setNote(activeArtifact.userAnnotations?.note ?? '');
                }}>Cancel</Button>
              </div>
              {saveError ? <div className={styles.error}>{saveError}</div> : null}
              {savedMessage ? <div className={styles.saved}>{savedMessage}</div> : null}
              {activeArtifact.userAnnotations?.updatedAtISO ? <p className={styles.timestamp}>Updated {new Date(activeArtifact.userAnnotations.updatedAtISO).toLocaleString()}</p> : null}
            </section>
          </>
        ) : null}
      </aside>
    </div>
  );
}
