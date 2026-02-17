'use client';

import { useCallback, useEffect, useState } from 'react';

import { parseApiError } from '../lib/apiErrors';
import type { AdminSettings } from '../lib/adminSettings';
import { DEFAULT_ADMIN_SETTINGS } from '../lib/adminSettings';
import styles from './page.module.css';

const defaultSettings: AdminSettings = {
  ...DEFAULT_ADMIN_SETTINGS,
  updatedAtISO: new Date(0).toISOString(),
};

type Status = 'loading' | 'ready' | 'forbidden' | 'reconnect' | 'error';

export default function AdminPageClient() {
  const [status, setStatus] = useState<Status>('loading');
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    setRequestId(null);

    try {
      const response = await fetch('/api/admin/settings');
      if (response.status === 401) {
        setStatus('reconnect');
        return;
      }
      if (response.status === 403) {
        setStatus('forbidden');
        return;
      }
      if (!response.ok) {
        const apiError = await parseApiError(response);
        setStatus('error');
        setErrorMessage(apiError?.message ?? 'Failed to load settings.');
        setRequestId(apiError?.requestId ?? null);
        return;
      }

      const payload = (await response.json()) as { settings: AdminSettings };
      setSettings(payload.settings);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load settings.');
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateField = <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    setRequestId(null);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          systemPrompt: settings.systemPrompt,
          maxContextItems: settings.maxContextItems,
          temperature: settings.temperature,
        }),
      });

      if (response.status === 401) {
        setStatus('reconnect');
        return;
      }
      if (response.status === 403) {
        setStatus('forbidden');
        return;
      }
      if (!response.ok) {
        const apiError = await parseApiError(response);
        setStatus('error');
        setErrorMessage(apiError?.message ?? 'Failed to save settings.');
        setRequestId(apiError?.requestId ?? null);
        return;
      }

      const payload = (await response.json()) as { settings: AdminSettings };
      setSettings(payload.settings);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  if (status === 'reconnect') {
    return (
      <div className={styles.container}>
        <h1>Admin settings</h1>
        <p className={styles.notice}>Please reconnect to view admin settings.</p>
      </div>
    );
  }

  if (status === 'forbidden') {
    return (
      <div className={styles.container}>
        <h1>Admin settings</h1>
        <p className={styles.notice}>403 — You do not have access to this page.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1>Admin settings</h1>
      <p className={styles.caption}>
        API keys are configured via environment variables on the server; they are not stored in
        Drive.
      </p>

      {status === 'loading' ? <p className={styles.notice}>Loading settings…</p> : null}

      {status === 'error' ? (
        <div className={styles.error}>
          <p>{errorMessage ?? 'Something went wrong.'}</p>
          {requestId ? <p className={styles.requestId}>Request ID: {requestId}</p> : null}
        </div>
      ) : null}

      <div className={styles.form}>
        <label className={styles.field}>
          <span>Provider</span>
          <select
            value={settings.provider}
            onChange={(event) => updateField('provider', event.target.value as AdminSettings['provider'])}
          >
            <option value="stub">stub</option>
            <option value="openai">openai</option>
            <option value="gemini">gemini</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Model</span>
          <input
            type="text"
            value={settings.model}
            onChange={(event) => updateField('model', event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>System prompt</span>
          <textarea
            rows={6}
            value={settings.systemPrompt}
            onChange={(event) => updateField('systemPrompt', event.target.value)}
          />
        </label>

        <div className={styles.inline}>
          <label className={styles.field}>
            <span>Max context items</span>
            <input
              type="number"
              min={1}
              value={settings.maxContextItems}
              onChange={(event) =>
                updateField(
                  'maxContextItems',
                  Number.isNaN(Number.parseInt(event.target.value, 10))
                    ? 0
                    : Number.parseInt(event.target.value, 10),
                )
              }
            />
          </label>

          <label className={styles.field}>
            <span>Temperature</span>
            <input
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={settings.temperature}
              onChange={(event) =>
                updateField(
                  'temperature',
                  Number.isNaN(Number.parseFloat(event.target.value))
                    ? 0
                    : Number.parseFloat(event.target.value),
                )
              }
            />
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={handleSave} disabled={isSaving || status === 'loading'}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
