'use client';

import React from 'react';
import Button from '../components/ui/Button';
import styles from './selectionBar.module.css';

type SelectionBarProps = {
  selectedCount: number;
  unauthorized: boolean;
  onSave: () => Promise<void>;
  onSummarize: () => Promise<void>;
  saveLoading: boolean;
  summarizeLoading: boolean;
  saveError: string | null;
  summarizeError: string | null;
  saveSuccess: string | null;
  summarizeNote?: string | null;
};

export default function SelectionBar({
  selectedCount,
  unauthorized,
  onSave,
  onSummarize,
  saveLoading,
  summarizeLoading,
  saveError,
  summarizeError,
  saveSuccess,
  summarizeNote,
}: SelectionBarProps) {
  const noSelection = selectedCount === 0;
  const disabled = unauthorized || noSelection || saveLoading || summarizeLoading;

  return (
    <div className={styles.bar} role="region" aria-label="Selection bar">
      <div className={styles.mainRow}>
        <p className={styles.count}>Selected: {selectedCount}</p>
        <div className={styles.actions}>
          <Button onClick={() => void onSave()} variant="secondary" disabled={disabled}>
            {saveLoading ? 'Saving…' : 'Save selection set'}
          </Button>
          <Button onClick={() => void onSummarize()} disabled={disabled}>
            {summarizeLoading ? 'Starting…' : 'Summarize selected'}
          </Button>
        </div>
      </div>
      <p className={styles.subtle}>Selections are saved to Drive.</p>
      {unauthorized ? <p className={styles.message}>Sign in required.</p> : null}
      {!unauthorized && noSelection ? <p className={styles.message}>Select items to continue.</p> : null}
      {!unauthorized && summarizeNote ? <p className={styles.message}>{summarizeNote}</p> : null}
      {saveSuccess ? <p className={styles.success}>{saveSuccess}</p> : null}
      {saveError ? <p className={styles.error}>{saveError}</p> : null}
      {summarizeError ? <p className={styles.error}>{summarizeError}</p> : null}
    </div>
  );
}
