'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { parseApiError } from '../../lib/apiErrors';
import type { AdminSettings } from '../../lib/adminSettings';
import { DEFAULT_ADMIN_SETTINGS } from '../../lib/adminSettings';
import styles from './page.module.css';

type Status = 'loading' | 'ready' | 'error' | 'reconnect';

type TestResult = {
  provider: string;
  model: string;
  summary: string;
  highlights: string[];
  timings: { ms: number };
};

const defaultSettings: AdminSettings = {
  ...DEFAULT_ADMIN_SETTINGS,
  updatedAtISO: new Date(0).toISOString(),
};

const toPositiveInteger = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
};

const toFloat = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export default function AdminSettingsForm() {
  const [status, setStatus] = useState<Status>('loading');
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!settings.provider) {
      errors.push('Provider is required.');
    }
    if (!settings.model.trim()) {
      errors.push('Model is required.');
    }
    if (!(settings.temperature >= 0 && settings.temperature <= 2)) {
      errors.push('Temperature must be between 0 and 2.');
    }
    if (!Number.isInteger(settings.maxContextItems) || settings.maxContextItems <= 0) {
      errors.push('Max context items must be a positive integer.');
    }
    if (
      settings.maxOutputTokens !== undefined &&
      (!Number.isInteger(settings.maxOutputTokens) || settings.maxOutputTokens <= 0)
    ) {
      errors.push('Max output tokens must be a positive integer when provided.');
    }
    return errors;
  }, [settings]);

  const loadSettings = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const response = await fetch('/api/admin/settings');
      if (response.status === 401) {
        setStatus('reconnect');
        return;
      }
      if (!response.ok) {
        const apiError = await parseApiError(response);
        setStatus('error');
        setErrorMessage(apiError?.message ?? 'Failed to load settings.');
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
    setSaved(false);
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (validation.length > 0) {
      setErrorMessage(validation[0]);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSaved(false);

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          systemPrompt: settings.systemPrompt,
          summaryPromptTemplate: settings.summaryPromptTemplate,
          highlightsPromptTemplate: settings.highlightsPromptTemplate,
          maxOutputTokens: settings.maxOutputTokens,
          maxContextItems: settings.maxContextItems,
          temperature: settings.temperature,
        }),
      });

      if (!response.ok) {
        const apiError = await parseApiError(response);
        setStatus(response.status === 401 ? 'reconnect' : 'error');
        setErrorMessage(apiError?.message ?? 'Failed to save settings.');
        return;
      }

      const payload = (await response.json()) as { settings: AdminSettings };
      setSettings(payload.settings);
      setStatus('ready');
      setSaved(true);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (validation.length > 0) {
      setErrorMessage(validation[0]);
      return;
    }

    setIsTesting(true);
    setErrorMessage(null);
    setTestResult(null);

    try {
      const response = await fetch('/api/admin/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          systemPrompt: settings.systemPrompt,
          summaryPromptTemplate: settings.summaryPromptTemplate,
          highlightsPromptTemplate: settings.highlightsPromptTemplate,
          maxOutputTokens: settings.maxOutputTokens,
          temperature: settings.temperature,
        }),
      });

      if (!response.ok) {
        const apiError = await parseApiError(response);
        setErrorMessage(apiError?.message ?? 'Failed to test provider.');
        return;
      }

      setTestResult((await response.json()) as TestResult);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to test provider.');
    } finally {
      setIsTesting(false);
    }
  };

  if (status === 'loading') {
    return <p className={styles.notice}>Loading settings…</p>;
  }

  if (status === 'reconnect') {
    return <p className={styles.notice}>Please reconnect to manage admin settings.</p>;
  }

  return (
    <div className={styles.form}>
      {errorMessage ? <div className={styles.error}>{errorMessage}</div> : null}
      {saved ? <p className={styles.saved}>Saved.</p> : null}
      {validation.length > 0 ? (
        <ul className={styles.validation}>
          {validation.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

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
        <input type="text" value={settings.model} onChange={(event) => updateField('model', event.target.value)} />
      </label>

      <label className={styles.field}>
        <span>Temperature</span>
        <input
          type="number"
          step="0.1"
          min={0}
          max={2}
          value={settings.temperature}
          onChange={(event) => updateField('temperature', toFloat(event.target.value))}
        />
      </label>

      <label className={styles.field}>
        <span>Max context items</span>
        <input
          type="number"
          min={1}
          value={settings.maxContextItems}
          onChange={(event) => updateField('maxContextItems', toPositiveInteger(event.target.value))}
        />
      </label>

      <label className={styles.field}>
        <span>Max output tokens (optional)</span>
        <input
          type="number"
          min={1}
          value={settings.maxOutputTokens ?? ''}
          onChange={(event) =>
            updateField(
              'maxOutputTokens',
              event.target.value.trim() ? toPositiveInteger(event.target.value) : undefined,
            )
          }
        />
      </label>

      <label className={styles.field}>
        <span>System prompt</span>
        <textarea
          rows={5}
          value={settings.systemPrompt}
          onChange={(event) => updateField('systemPrompt', event.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span>Summary prompt template (optional)</span>
        <textarea
          rows={4}
          value={settings.summaryPromptTemplate ?? ''}
          onChange={(event) => updateField('summaryPromptTemplate', event.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span>Highlights prompt template (optional)</span>
        <textarea
          rows={4}
          value={settings.highlightsPromptTemplate ?? ''}
          onChange={(event) => updateField('highlightsPromptTemplate', event.target.value)}
        />
      </label>

      <p className={styles.helper}>
        Supported template tokens: {'{title}'}, {'{text}'}, {'{source}'}, {'{metadata}'}.
      </p>

      <div className={styles.actions}>
        <button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={handleTest} disabled={isTesting}>
          {isTesting ? 'Testing…' : 'Test current settings'}
        </button>
      </div>

      {testResult ? (
        <div className={styles.result}>
          <p>
            <strong>
              {testResult.provider} / {testResult.model}
            </strong>{' '}
            ({testResult.timings.ms} ms)
          </p>
          <p>{testResult.summary}</p>
          {testResult.highlights.length > 0 ? (
            <ul>
              {testResult.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
