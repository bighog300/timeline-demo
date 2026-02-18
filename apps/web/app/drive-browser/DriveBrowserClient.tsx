'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import Button from '../components/ui/Button';
import { parseApiError } from '../lib/apiErrors';
import styles from './driveBrowser.module.css';

type DriveBrowseItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
  isFolder: boolean;
};

type SavedSelection = {
  fileId: string;
  name: string;
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

export default function DriveBrowserClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = searchParams?.get('folderId') ?? '';

  const [items, setItems] = useState<DriveBrowseItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [searchText, setSearchText] = useState(searchParams?.get('q') ?? '');
  const [mimeGroup, setMimeGroup] = useState<'all' | 'docs' | 'pdf'>((searchParams?.get('mimeGroup') as 'all' | 'docs' | 'pdf') ?? 'all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savedSelections, setSavedSelections] = useState<SavedSelection[]>([]);
  const [targetSelectionId, setTargetSelectionId] = useState('');

  const selectedItems = useMemo(
    () => items.filter((item) => !item.isFolder && selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  const loadItems = async (token?: string, append = false) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    if (searchText.trim()) params.set('q', searchText.trim());
    if (mimeGroup) params.set('mimeGroup', mimeGroup);
    if (token) params.set('pageToken', token);

    const response = await fetch(`/api/drive/browse?${params.toString()}`);
    const payload = (await response.json()) as {
      items?: DriveBrowseItem[];
      nextPageToken?: string | null;
      message?: string;
    };

    if (!response.ok) {
      setLoading(false);
      setError(payload.message ?? 'Failed to browse Drive files.');
      return;
    }

    setItems((previous) => (append ? [...previous, ...(payload.items ?? [])] : (payload.items ?? [])));
    setNextPageToken(payload.nextPageToken ?? null);
    setLoading(false);
  };

  useEffect(() => {
    void loadItems(undefined, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  const updateQueryParams = () => {
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    if (searchText.trim()) params.set('q', searchText.trim());
    if (mimeGroup !== 'all') params.set('mimeGroup', mimeGroup);
    router.replace(`/drive-browser?${params.toString()}`);
    void loadItems(undefined, false);
  };

  const navigateFolder = (nextFolderId: string) => {
    const params = new URLSearchParams();
    params.set('folderId', nextFolderId);
    if (mimeGroup !== 'all') params.set('mimeGroup', mimeGroup);
    router.push(`/drive-browser?${params.toString()}`);
    setSelectedIds([]);
  };

  const toggleFile = (id: string) => {
    setSelectedIds((previous) => (previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]));
  };

  const createSelection = async () => {
    const name = window.prompt('Name for the new saved selection?');
    if (!name) return;

    setSaving(true);
    setSaveMessage(null);

    const response = await fetch('/api/timeline/selections/create-from-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        source: 'drive',
        items: selectedItems.map((item) => ({
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          modifiedTime: item.modifiedTime,
        })),
      }),
    });

    const apiError = response.ok ? null : await parseApiError(response);
    if (!response.ok) {
      setSaving(false);
      setSaveMessage(apiError?.message ?? 'Failed to create selection.');
      return;
    }

    setSaving(false);
    setSaveMessage('Saved new selection.');
    setSelectedIds([]);
  };

  const loadSavedSelections = async () => {
    const response = await fetch('/api/timeline/selections/list');
    if (!response.ok) {
      setError('Failed to load saved selections.');
      return;
    }

    const payload = (await response.json()) as { items?: SavedSelection[] };
    setSavedSelections(payload.items ?? []);
    if ((payload.items ?? []).length > 0) {
      setTargetSelectionId(payload.items?.[0]?.fileId ?? '');
    }
  };

  const addToExisting = async () => {
    if (!targetSelectionId) {
      setSaveMessage('Choose a selection first.');
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    const response = await fetch(`/api/timeline/selections/${encodeURIComponent(targetSelectionId)}/add-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'drive',
        items: selectedItems.map((item) => ({
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          modifiedTime: item.modifiedTime,
        })),
      }),
    });

    const apiError = response.ok ? null : await parseApiError(response);
    if (!response.ok) {
      setSaving(false);
      setSaveMessage(apiError?.message ?? 'Failed to update selection.');
      return;
    }

    setSaving(false);
    setSaveMessage('Added items to existing selection.');
    setSelectedIds([]);
  };

  const folders = items.filter((item) => item.isFolder);
  const files = items.filter((item) => !item.isFolder);

  return (
    <main className={styles.container}>
      <h1>Drive Browser</h1>
      <p className={styles.muted}>App-folder scoped (MVP): app folder + one-level child folders only.</p>

      <div className={styles.controls}>
        <input
          aria-label="Search files"
          placeholder="Search files"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <select
          aria-label="MIME group"
          value={mimeGroup}
          onChange={(event) => setMimeGroup(event.target.value as 'all' | 'docs' | 'pdf')}
        >
          <option value="all">All</option>
          <option value="docs">Docs</option>
          <option value="pdf">PDF</option>
        </select>
        <Button onClick={updateQueryParams} disabled={loading}>Browse</Button>
      </div>

      <p>Current folder: <code>{folderId || '(app folder)'}</code></p>
      <p>Selected files: {selectedItems.length}</p>

      {error ? <p className={styles.error}>{error}</p> : null}
      {saveMessage ? <p>{saveMessage}</p> : null}

      <div className={styles.list}>
        {[...folders, ...files].map((item) => (
          <div key={item.id} className={styles.row}>
            {item.isFolder ? (
              <span aria-hidden="true">📁</span>
            ) : (
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                aria-label={`Select ${item.name}`}
                onChange={() => toggleFile(item.id)}
              />
            )}

            {item.isFolder ? (
              <button className={styles.folderButton} type="button" onClick={() => navigateFolder(item.id)}>
                {item.name}
              </button>
            ) : (
              <span>{item.name}</span>
            )}

            <span className={styles.meta}>{formatDate(item.modifiedTime)}</span>
          </div>
        ))}
      </div>

      {nextPageToken ? (
        <Button onClick={() => void loadItems(nextPageToken, true)} disabled={loading}>Load more</Button>
      ) : null}

      <div className={styles.actions}>
        <Button onClick={() => void createSelection()} disabled={selectedItems.length === 0 || saving}>
          Save as new Saved Selection
        </Button>

        <Button onClick={() => void loadSavedSelections()} disabled={saving}>
          Add to existing...
        </Button>

        {savedSelections.length > 0 ? (
          <div className={styles.inline}>
            <select
              aria-label="Saved selection"
              value={targetSelectionId}
              onChange={(event) => setTargetSelectionId(event.target.value)}
            >
              {savedSelections.map((item) => (
                <option key={item.fileId} value={item.fileId}>{item.name}</option>
              ))}
            </select>
            <Button onClick={() => void addToExisting()} disabled={selectedItems.length === 0 || saving}>
              Add selected files
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
