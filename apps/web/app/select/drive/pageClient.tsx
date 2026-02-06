'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import styles from '../selection.module.css';

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  iconLink?: string;
};

type DriveSelectClientProps = {
  isConfigured: boolean;
};

const STORAGE_KEY = 'timeline.driveSelections';

const parseStoredSelections = () => {
  if (typeof window === 'undefined') {
    return [] as DriveFile[];
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [] as DriveFile[];
  }

  try {
    const parsed = JSON.parse(stored) as DriveFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as DriveFile[];
  }
};

export default function DriveSelectClient({ isConfigured }: DriveSelectClientProps) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [includeFolders, setIncludeFolders] = useState(false);

  useEffect(() => {
    setSelectedIds(parseStoredSelections().map((item) => item.id));
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const fetchFiles = async () => {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/google/drive/list?includeFolders=${includeFolders}`);
      if (response.status === 401) {
        setError('reconnect_required');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        setError('Unable to load Drive files.');
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as { files: DriveFile[] };
      setFiles(payload.files ?? []);
      setLoading(false);
    };

    fetchFiles();
  }, [includeFolders, isConfigured]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleSelection = (fileId: string) => {
    setSelectedIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId],
    );
  };

  const handleSave = () => {
    const selectedFiles = files.filter((file) => selectedSet.has(file.id));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedFiles));
  };

  const reconnectNotice = (
    <div className={styles.notice}>
      Reconnect required. Please <Link href="/connect">connect your Google account</Link>.
    </div>
  );

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p>Pick Drive files you want in the Timeline selection.</p>
          <h1>Drive selection</h1>
        </div>
        <div className={styles.actions}>
          <Button
            onClick={handleSave}
            variant="primary"
            disabled={selectedIds.length === 0 || files.length === 0}
          >
            Add to Timeline selection
          </Button>
          <Badge tone="neutral">{selectedIds.length} selected</Badge>
        </div>
      </div>

      <label className={styles.muted}>
        <input
          type="checkbox"
          checked={includeFolders}
          onChange={(event) => setIncludeFolders(event.target.checked)}
        />{' '}
        Include folders
      </label>

      {!isConfigured ? (
        <div className={styles.emptyState}>
          Google OAuth isn&apos;t configured yet. Add the required environment variables to enable
          Drive selection.
        </div>
      ) : null}

      {error === 'reconnect_required' ? reconnectNotice : null}
      {error && error !== 'reconnect_required' ? <div className={styles.notice}>{error}</div> : null}

      {loading ? <p className={styles.muted}>Loading Drive files...</p> : null}

      {!loading && files.length === 0 && isConfigured ? (
        <div className={styles.emptyState}>No recent Drive files found.</div>
      ) : null}

      <div className={styles.list}>
        {files.map((file) => (
          <label key={file.id} className={styles.item}>
            <input
              type="checkbox"
              checked={selectedSet.has(file.id)}
              onChange={() => toggleSelection(file.id)}
            />
            <div>
              <div className={styles.itemHeader}>
                <strong>{file.name}</strong>
                <span className={styles.itemMeta}>{file.modifiedTime ?? '—'}</span>
              </div>
              <p className={styles.itemMeta}>{file.mimeType}</p>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
