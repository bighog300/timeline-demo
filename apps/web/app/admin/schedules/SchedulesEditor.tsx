'use client';

import { useEffect, useState } from 'react';

export default function SchedulesEditor() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [authWarning, setAuthWarning] = useState(false);
  const [lastLoadedValue, setLastLoadedValue] = useState('');

  const loadSchedules = async () => {
    const response = await fetch('/api/admin/schedules');
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message ?? 'Failed to load schedules');
    const formatted = JSON.stringify(json.config, null, 2);
    setValue(formatted);
    setLastLoadedValue(formatted);
    setSaved(false);
    setError(null);
  };

  useEffect(() => {
    fetch('/api/admin/ops/status').then((r) => r.json()).then((json) => {
      setAuthWarning(Boolean(json?.issues?.auth?.missingRefreshToken || json?.issues?.auth?.insufficientScope));
    }).catch(() => {});

    loadSchedules().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load schedules');
      });
  }, []);

  const onFormat = () => {
    setError(null);
    try {
      setValue(JSON.stringify(JSON.parse(value), null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const onReload = async () => {
    if (value !== lastLoadedValue) {
      const confirmed = window.confirm('Discard unsaved changes and reload from server?');
      if (!confirmed) {
        return;
      }
    }
    try {
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    }
  };

  const onSave = async () => {
    setSaved(false);
    setError(null);
    try {
      const parsed = JSON.parse(value) as unknown;
      const response = await fetch('/api/admin/schedules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const json = await response.json();
      if (!response.ok) {
        const serverError = json?.error;
        if (response.status === 400 && serverError) {
          const details = typeof serverError.details === 'string' ? `\n${serverError.details}` : '';
          throw new Error(`${serverError.message ?? 'Invalid schedule config'}${details}`);
        }
        throw new Error(serverError?.message ?? 'Failed to save schedules');
      }
      const formatted = JSON.stringify(json.config, null, 2);
      setValue(formatted);
      setLastLoadedValue(formatted);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedules');
    }
  };

  return (
    <div>
      {authWarning ? <p>Auth permissions need re-consent. See /admin/ops for guidance.</p> : null}
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={24} cols={100} />
      <div>
        <button type="button" onClick={onFormat}>Format JSON</button>
        <button type="button" onClick={() => { void onReload(); }}>Reload</button>
        <button type="button" onClick={onSave}>Save schedule config</button>
      </div>

      <p>
        Notify snippet example: <code>{`"notify": { "enabled": true, "to": ["ops@example.com"], "subjectPrefix": "[Timeline]", "includeLinks": true }`}</code>
      </p>
      <p>
        Routes snippet example: <code>{`"recipientProfiles": [{"id":"p1","to":["p1@example.com"],"filters":{"entities":["acme"]}}], "notify": {"enabled": true, "mode": "routes", "routes": [{"profileId": "p1", "subjectPrefix": "[Acme]"}]}`}</code>
      </p>
      {saved ? <p>Saved.</p> : null}
      {error ? <pre>{error}</pre> : null}
    </div>
  );
}
