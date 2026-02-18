'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

import Button from '../components/ui/Button';
import { parseApiError } from '../lib/apiErrors';
import styles from './savedSelections.module.css';

type SelectionItem = {
  fileId: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const trimSuffix = (name: string) => name.replace(/ - Selection\.json$/i, '').trim();

export default function SavedSelectionsClient() {
  const router = useRouter();
  const [items, setItems] = React.useState<SelectionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameName, setRenameName] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch('/api/timeline/selections/list');
    const payload = (await response.json()) as { items?: SelectionItem[] };

    if (!response.ok) {
      const parsed = await parseApiError(response);
      setError(parsed?.message ?? 'Failed to load saved selections.');
      setLoading(false);
      return;
    }

    setItems(payload.items ?? []);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => trimSuffix(item.name).toLowerCase().includes(query));
  }, [items, search]);

  const startRename = (item: SelectionItem) => {
    setRenameId(item.fileId);
    setRenameName(trimSuffix(item.name));
    setMessage(null);
    setError(null);
  };

  const saveRename = async (fileId: string) => {
    setBusyId(fileId);
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/timeline/selections/${fileId}/rename`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: renameName }),
    });

    if (!response.ok) {
      const parsed = await parseApiError(response);
      setError(parsed?.message ?? 'Rename failed.');
      setBusyId(null);
      return;
    }

    setRenameId(null);
    setRenameName('');
    setMessage('Renamed selection.');
    setBusyId(null);
    await load();
    router.refresh();
  };

  const deleteItem = async (item: SelectionItem) => {
    const confirmed = window.confirm(`Delete "${trimSuffix(item.name)}"?`);
    if (!confirmed) return;

    setBusyId(item.fileId);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/timeline/selections/${item.fileId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const parsed = await parseApiError(response);
      setError(parsed?.message ?? 'Delete failed.');
      setBusyId(null);
      return;
    }

    setMessage('Deleted selection.');
    setBusyId(null);
    await load();
    router.refresh();
  };

  return (
    <main className={styles.page}>
      <h1>Saved Selections</h1>
      <p className={styles.subtext}>Saved item lists used for Chat/Timeline context</p>

      <label className={styles.searchLabel}>
        Search
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by name"
          className={styles.search}
        />
      </label>

      {message ? <p className={styles.success}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p>Loading…</p> : null}

      {!loading && filtered.length === 0 ? (
        <p>No saved selections yet. Create one from Chat context.</p>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Modified</th>
              <th>Drive</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const isRenaming = renameId === item.fileId;
              return (
                <tr key={item.fileId}>
                  <td>
                    {isRenaming ? (
                      <input
                        aria-label={`Rename ${trimSuffix(item.name)}`}
                        value={renameName}
                        onChange={(event) => setRenameName(event.target.value)}
                      />
                    ) : (
                      trimSuffix(item.name)
                    )}
                  </td>
                  <td>{item.modifiedTime ? new Date(item.modifiedTime).toLocaleString() : '—'}</td>
                  <td>
                    {item.webViewLink ? (
                      <a href={item.webViewLink} target="_blank" rel="noreferrer">
                        Open in Drive
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={styles.actions}>
                    {isRenaming ? (
                      <>
                        <Button onClick={() => void saveRename(item.fileId)} disabled={busyId === item.fileId}>
                          Save
                        </Button>
                        <Button variant="secondary" onClick={() => setRenameId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={() => startRename(item)}>
                          Rename
                        </Button>
                        <Button variant="secondary" onClick={() => void deleteItem(item)} disabled={busyId === item.fileId}>
                          Delete
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
