'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import Button from '../components/ui/Button';
import { parseApiError } from '../lib/apiErrors';
import styles from './driveBrowser.module.css';

type DriveBrowseScope = 'app' | 'root';
type MimeGroup = 'all' | 'docs' | 'pdf';
type LimitOption = 200 | 500;

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

type ResolvePreviewResponse = {
  dryRun: boolean;
  limit: number;
  foundFiles: number;
  truncated: boolean;
  files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string | null; webViewLink: string | null }>;
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

export default function DriveBrowserClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = searchParams?.get('folderId') ?? '';

  const [scope, setScope] = useState<DriveBrowseScope>((searchParams?.get('scope') as DriveBrowseScope) ?? 'app');
  const [items, setItems] = useState<DriveBrowseItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [searchText, setSearchText] = useState(searchParams?.get('q') ?? '');
  const [mimeGroup, setMimeGroup] = useState<MimeGroup>((searchParams?.get('mimeGroup') as MimeGroup) ?? 'all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savedSelections, setSavedSelections] = useState<SavedSelection[]>([]);
  const [targetSelectionId, setTargetSelectionId] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [preview, setPreview] = useState<ResolvePreviewResponse | null>(null);
  const [selectionName, setSelectionName] = useState('');
  const [limit, setLimit] = useState<LimitOption>(200);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)).map(({ id, isFolder }) => ({ id, isFolder })),
    [items, selectedIds],
  );

  const loadItems = async (token?: string, append = false) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set('scope', scope);
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
  }, [folderId, scope]);

  const updateQueryParams = () => {
    const params = new URLSearchParams();
    params.set('scope', scope);
    if (folderId) params.set('folderId', folderId);
    if (searchText.trim()) params.set('q', searchText.trim());
    if (mimeGroup !== 'all') params.set('mimeGroup', mimeGroup);
    router.replace(`/drive-browser?${params.toString()}`);
    void loadItems(undefined, false);
  };

  const navigateFolder = (nextFolderId: string) => {
    const params = new URLSearchParams();
    params.set('scope', scope);
    params.set('folderId', nextFolderId);
    if (mimeGroup !== 'all') params.set('mimeGroup', mimeGroup);
    router.push(`/drive-browser?${params.toString()}`);
    setSelectedIds([]);
  };

  const onScopeChange = (nextScope: DriveBrowseScope) => {
    setScope(nextScope);
    setSelectedIds([]);
    setPreview(null);
    const params = new URLSearchParams();
    params.set('scope', nextScope);
    params.set('folderId', nextScope === 'root' ? 'root' : '');
    router.push(`/drive-browser?${params.toString()}`);
  };

  const toggleItem = (id: string) => {
    setSelectedIds((previous) => (previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]));
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

  const previewSelection = async () => {
    setSaving(true);
    setSaveMessage(null);

    const response = await fetch('/api/drive/resolve-selection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, items: selectedItems, mimeGroup, limit, dryRun: true }),
    });

    const apiError = response.ok ? null : await parseApiError(response);
    if (!response.ok) {
      setSaving(false);
      setSaveMessage(apiError?.message ?? 'Failed to preview selection.');
      return;
    }

    const payload = (await response.json()) as ResolvePreviewResponse;
    setPreview(payload);
    setSaving(false);
  };

  const createSelection = async () => {
    if (!selectionName.trim()) {
      setSaveMessage('Provide a name for your saved selection.');
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    const response = await fetch('/api/timeline/selections/create-from-drive-browse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: selectionName.trim(),
        scope,
        picked: selectedItems,
        mimeGroup,
        limit,
      }),
    });

    const apiError = response.ok ? null : await parseApiError(response);
    if (!response.ok) {
      setSaving(false);
      setSaveMessage(apiError?.message ?? 'Failed to create selection.');
      return;
    }

    setSaving(false);
    setSaveMessage('Saved new selection. View it in Saved Selections.');
    setSelectedIds([]);
    setPreview(null);
  };

  const addToExisting = async () => {
    if (!targetSelectionId) {
      setSaveMessage('Choose a selection first.');
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    const response = await fetch(`/api/timeline/selections/${encodeURIComponent(targetSelectionId)}/add-from-drive-browse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, picked: selectedItems, mimeGroup, limit }),
    });

    const apiError = response.ok ? null : await parseApiError(response);
    if (!response.ok) {
      setSaving(false);
      setSaveMessage(apiError?.message ?? 'Failed to update selection.');
      return;
    }

    setSaving(false);
    setSaveMessage('Added items to existing selection. View in Saved Selections.');
    setSelectedIds([]);
    setPreview(null);
  };

  const folders = items.filter((item) => item.isFolder);
  const files = items.filter((item) => !item.isFolder);

  return (
    <main className={styles.container}>
      <h1>Drive Browser</h1>
      <div className={styles.inline}>
        <label htmlFor="scope-select">Scope</label>
        <select id="scope-select" aria-label="Scope" value={scope} onChange={(event) => onScopeChange(event.target.value as DriveBrowseScope)}>
          <option value="app">App folder</option>
          <option value="root">My Drive</option>
        </select>
      </div>

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
          onChange={(event) => setMimeGroup(event.target.value as MimeGroup)}
        >
          <option value="all">All</option>
          <option value="docs">Docs</option>
          <option value="pdf">PDF</option>
        </select>
        <Button onClick={updateQueryParams} disabled={loading}>Browse</Button>
      </div>

      <p>Current folder: <code>{folderId || (scope === 'root' ? 'root' : '(app folder)')}</code></p>
      <p>Selected items: {selectedItems.length}</p>

      {error ? <p className={styles.error}>{error}</p> : null}
      {saveMessage ? <p>{saveMessage} <a href="/saved-selections">Go to Saved Selections</a></p> : null}

      <div className={styles.list}>
        {[...folders, ...files].map((item) => (
          <div key={item.id} className={styles.row}>
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              aria-label={`Select ${item.name}`}
              onChange={() => toggleItem(item.id)}
            />

            {item.isFolder ? (
              <button className={styles.folderButton} type="button" onClick={() => navigateFolder(item.id)}>
                📁 {item.name}
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
        <Button onClick={() => { setShowPanel((value) => !value); void loadSavedSelections(); }} disabled={selectedItems.length === 0 || saving}>
          Add to Timeline…
        </Button>
      </div>

      {showPanel ? (
        <section className={styles.panel}>
          <h2>Add selected Drive items to timeline</h2>
          <div className={styles.inline}>
            <label htmlFor="limit-select">Limit</label>
            <select id="limit-select" aria-label="Limit" value={limit} onChange={(event) => setLimit(Number(event.target.value) as LimitOption)}>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
            <Button onClick={() => void previewSelection()} disabled={selectedItems.length === 0 || saving}>Preview</Button>
          </div>

          {preview ? (
            <div>
              <p>
                Will add about {preview.foundFiles} files
                {preview.truncated ? ` (truncated to limit ${preview.limit})` : ''}.
              </p>
              <ul>
                {preview.files.map((file) => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={styles.inline}>
            <input
              aria-label="Selection name"
              placeholder="New saved selection name"
              value={selectionName}
              onChange={(event) => setSelectionName(event.target.value)}
            />
            <Button onClick={() => void createSelection()} disabled={saving}>Create new Saved Selection</Button>
          </div>

          <div className={styles.inline}>
            <select
              aria-label="Saved selection"
              value={targetSelectionId}
              onChange={(event) => setTargetSelectionId(event.target.value)}
            >
              <option value="">Select existing Saved Selection</option>
              {savedSelections.map((item) => (
                <option key={item.fileId} value={item.fileId}>{item.name}</option>
              ))}
            </select>
            <Button onClick={() => void addToExisting()} disabled={saving}>Add to existing Saved Selection</Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
